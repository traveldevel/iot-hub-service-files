// Load env vars from .env
require('dotenv').config();

var express = require('express');
var mongodb = require('mongodb')
var multer  = require('multer');
var Grid = require('gridfs-stream');
var fs = require('fs');
const cfenv = require("cfenv");
const basicAuth = require('basic-auth');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

// configs from env vars
var appEnv = cfenv.getAppEnv();
//console.log(appEnv.getServices());

const services = appEnv.getServices();

if(!appEnv.isLocal){
    console.log("appEnv.isLocal=", appEnv.isLocal);
}

const port = process.env.PORT || 8080;
const authorizedUsers = process.env.BASIC_AUTH_USERS.split(',');
const authorizedUserPasswords = process.env.BASIC_AUTH_USER_PASSWORDS.split(',');

// auth global function
const auth = function (req, res, next) {
    
    if(req.method === "OPTIONS"){
        return next();
    }

    function unauthorized(res) {
        res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
        return res.sendStatus(401);
    };

    var user = basicAuth(req);

    if (!user || !user.name || !user.pass) {
        return unauthorized(res);
    };

    if (authorizedUsers.indexOf(user.name) >= 0 && authorizedUserPasswords.indexOf(user.pass) >= 0) {
        return next();
    } else {
        return unauthorized(res);
    };
};

// get mongo url from service function
var getMongoUrlForService = function(mongoServiceName) {
    
    var mongoService = services[mongoServiceName];

    var mongoCredentials = {};
    var mongoUrl = '';

    if(mongoService !== undefined){
        mongoCredentials = services[mongoServiceName].credentials;
        mongoUrl = mongoCredentials.uri;

        var mongodbUri = require('mongodb-uri');
        var uriObject = mongodbUri.parse(mongoUrl);
        mongoDbName = uriObject.database;
        
        console.log("'" + mongoServiceName + "' found in VCAP_SERVICES ! ");
        console.log("Url for mongodb : '" + mongoUrl + "'");      
        console.log("DB for mongodb : '" + mongoDbName + "'");  
    }

    return mongoUrl;
}

const landscapeName = process.env.LANDSCAPE_NAME;
const tenantName = process.env.TENANT_NAME;

const mongoServiceBaseName = "iot_hub_mongo_" + landscapeName + "_" + tenantName;
var mongoConnData = getMongoUrlForService(mongoServiceBaseName + "_files");
var mongoUrl = mongoConnData.url; 
var mongoDbName = mongoConnData.db;

if(process.env.MONGODB_URL !== undefined && services[mongoServiceBaseName + "_files"] === undefined){
    mongoUrl = process.env.MONGODB_URL;
    var mongodbUri = require('mongodb-uri');
    var uriObject = mongodbUri.parse(mongoUrl);
    mongoDbName = uriObject.database;

    console.log("mongodb url found in process.env.MONGODB_URL !");
    console.log("Url for mongodb : '" + mongoUrl + "'");
    console.log("DB for mongodb : '" + mongoDbName + "'");
}

if(mongoUrl.length === 0){
    console.log('No mongo files service Binded. Exiting...');
    return;
}

var app = express();

app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(multer({ dest: './uploads/' }).any());

// file info
app.get('/file/info/:id', auth, function(req, res){
    
    var file_id = req.params.id;

    gfs.files.find({ _id : file_id }).toArray(function (err, files) {
        
        if (err) return res.status(400).send(err);
        if (!files) return res.status(404).send('');
        
        console.log(files);
    });
});

// file delete
app.get('/file/delete/:id', auth, function(req, res){
    
    var file_id = new ObjectID(req.params.id);
    console.log("Deletion of file_id : ", file_id);

    MongoClient.connect(mongoUrl, function(err, db) {
        
        if(err){
            console.log(err);
        }
    
        var gfs = Grid(db, mongodb);

        db.collection("file").find({ _id: file_id }).toArray(function (err, mfiles) {

            //console.log(mfiles);

            if(mfiles.length === 0){
                return res.status(404).send('File Not Found');
            }

            var gfs_id = mfiles[0].gfs_id;

            gfs.remove({ _id : gfs_id }, function (err, gridStore) {
                
                if (err) return handleError(err);

                db.collection("file").deleteOne({ _id: file_id }, function (err, results){
                    db.close();
                    res.status(200).send('OK');
                });
            });        
        });
    });
});

//file download
app.get('/file/download/:id', auth, function(req, res){

    var file_id = new ObjectID(req.params.id);
    console.log("Requested file_id : ", file_id);

    MongoClient.connect(mongoUrl, function(err, db) {
        
        if(err){
            console.log(err);
        }
    
        var gfs = Grid(db, mongodb);

        db.collection("file").find({ _id: file_id }).toArray(function (err, mfiles) {

            //console.log(mfiles);

            if(mfiles.length === 0){
                return res.status(404).send('File Not Found');
            }

            var gfs_id = mfiles[0].gfs_id;

            gfs.files.find({ _id: gfs_id }).toArray(function (err, files) {
                
                if (err) return res.status(400).send(err);
                if (!files) return res.status(404).send('');
                
                if (files.length > 0) {
    
                    console.log(files[0]);
    
                    var mime = files[0].contentType;
                    res.set('Content-Type', mime);

                    var read_stream = gfs.createReadStream({ _id: gfs_id });
                    read_stream.pipe(res);

                    read_stream.on("close", function(){
                        db.close();
                    });
                } 
                else 
                {
                    res.json('File Not Found');
                    db.close();
                }
            });            
        });
    });
});

// file upload
app.all('/file/upload/:device_id', auth, function(req, res){

    var dirname = require('path').dirname(require.main.filename);
    //console.log(req.files);

    var device_id = req.params.device_id;

    var file = req.files[0];

    var originalname = file.originalname;
    var filename = file.filename;
    var path = file.path;
    var type = file.mimetype;
     
    var read_stream = fs.createReadStream(dirname + '/' + path);
     
    MongoClient.connect(mongoUrl, function(err, db) {
        
        if(err){
            console.log(err);
        }
    
        var gfs = Grid(db, mongodb);

        var writestream = gfs.createWriteStream({
            filename: filename
        });
     
        read_stream.pipe(writestream);
     
        var completeName = dirname + '/uploads/' + filename;

        writestream.on('close', function(data) {
            
            //console.log(data);

            var newFile = {
                device_id: device_id,
                gfs_id : data._id,
                content_type: data.contentType,
                md5: data.md5,
                created_at: data.uploadDate,
                size: data.length,
                filename: originalname
            };

            db.collection("file").insertOne(newFile, function(err, result) {
                if (err) throw err;

                console.log("1 file inserted");
                db.close();

                fs.unlink(completeName, function(err) {
                    res.send("OK");
                });
            });
         });        
    });
});

app.get('/', auth, function(req, res){

    res.writeHead(200, {'Content-Type': 'text/html'});
    
    res.write('<form action="file/upload/test_device_for_upload" method="post" enctype="multipart/form-data">');
    res.write('<input type="file" name="filetoupload"><br/>');
    res.write('<input type="submit">');
    res.write('</form>');
    
    return res.end();
});

// app listen
app.listen(port, function () {
    console.log('REST API listening on ' + appEnv.url + ':' + port);
});
