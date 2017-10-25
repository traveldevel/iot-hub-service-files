// Load env vars from .env
require('dotenv').config();

var express = require('express');
var mongodb = require('mongodb')
var multer  = require('multer');
var Grid = require('gridfs-stream');
var fs = require('fs');
const cfenv = require("cfenv");
const basicAuth = require('basic-auth');

var mongoose = require('mongoose');
var Schema = mongoose.Schema;

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
        
        console.log("'" + mongoServiceName + "' found in VCAP_SERVICES ! ");
        console.log("Url for mongodb : '" + mongoUrl + "'");        
    }

    return mongoUrl;
}

const landscapeName = process.env.LANDSCAPE_NAME;
const tenantName = process.env.TENANT_NAME;

const mongoServiceBaseName = "iot_hub_mongo_" + landscapeName + "_" + tenantName;
const mongoUrlFiles = getMongoUrlForService(mongoServiceBaseName + "_files");

if(mongoUrlFiles.length === 0){
    console.log('No mongo files service Binded. Exiting...');
    return;
}

// create or use an existing mongodb-native db instance.
// for this example we'll just create one:
// var db = new mongodb.Db(mongoUrlFiles);

// // make sure the db instance is open before passing into `Grid`
// db.open(function (err) {
//   if (err) return handleError(err);
//   var gfs = Grid(db, mongodb);

//   // all set!
// })

var MongoClient = require('mongodb').MongoClient;

MongoClient.connect(mongoUrlFiles, function(err, db) {
    
    if (err) return handleError(err);

    console.log("Connected correctly to server");

    db.close();
});


var app = express();

app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(multer({ dest: './uploads/' }).any());

// file info
app.get('/file/info/:id', auth, function(req, res){
    
    var file_id = req.param('id');

    gfs.files.find({ _id : file_id }).toArray(function (err, files) {
        
        if (err) return res.status(400).send(err);
        if (!files) return res.status(404).send('');
        
        console.log(files);
    });
});

// file delete
app.get('/file/delete/:id', auth, function(req, res){
    
    var file_id = req.param('id');

    gfs.remove({ _id : file_id }, function (err, gridStore) {
        if (err) return handleError(err);
        console.log('success');
    });
});


//file download
app.get('/file/download/:id', auth, function(req, res){

    var file_id = req.param('id');
    var gfs = req.gfs;

    gfs.files.find({ _id : file_id }).toArray(function (err, files) {

        if (err) return res.status(400).send(err);
        if (!files) return res.status(404).send('');
        
        if (files.length > 0) {
            var mime = 'image/jpeg';
            res.set('Content-Type', mime);
            var read_stream = gfs.createReadStream({filename: file_id});
            read_stream.pipe(res);
        } 
        else 
        {
            res.json('File Not Found');
        }
    });
});

// file upload
app.all('/file/upload', auth, function(req, res){

    var dirname = require('path').dirname(__dirname);
    var filename = req.files.file.name;
    var path = req.files.file.path;
    var type = req.files.file.mimetype;
     
    var read_stream = fs.createReadStream(dirname + '/' + path);
     
    var writestream = gfs.createWriteStream({
       filename: filename
    });

    read_stream.pipe(writestream);

    var completeName = 'uploads/' + filename;

    writestream.on('close', function () {
        gfs.unlinkSync(completeName); 
    });
});

app.get('/', auth, function(req, res){

    res.writeHead(200, {'Content-Type': 'text/html'});
    
    res.write('<form action="fileupload" method="post" enctype="multipart/form-data">');
    res.write('<input type="file" name="filetoupload"><br>');
    res.write('<input type="submit">');
    res.write('</form>');
    
    return res.end();
});

// app listen
app.listen(port, function () {
    console.log('REST API listening on ' + appEnv.url + ':' + port);
});
