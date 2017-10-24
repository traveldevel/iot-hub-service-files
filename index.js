// Load env vars from .env
require('dotenv').config();

var express = require('express');
var mongodb = require('mongodb')
var multer  = require('multer');
var Grid = require('gridfs-stream');
var fs = require('fs');
const cfenv = require("cfenv");

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

// get mongo url from service function
var getMongoUrlForService = function(mongoServiceName) {
    
    var mongoService = services[mongoServiceName];

    var mongoCredentials = {};
    var mongoUrl = '';

    if(mongoService !== undefined){
        mongoCredentials = services[mongoServiceName].credentials;
        mongoUrl = mongoCredentials.uri;
    }

    console.log("'" + mongoServiceName + "' found in VCAP_SERVICES ! ");
    console.log("Url for mongodb : '" + mongoUrl + "'");

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
var db = new mongodb.Db(mongoUrlFiless);

// make sure the db instance is open before passing into `Grid`
db.open(function (err) {
  if (err) return handleError(err);
  var gfs = Grid(db, mongodb);

  // all set!
})

var app = express();

app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(multer({ dest: './uploads/' }).any());

// file info
app.get('/file/info/:id',function(req, res){
    
    var file_id = req.param('id');

    gfs.files.find({ _id : file_id }).toArray(function (err, files) {
        
        if (err) return res.status(400).send(err);
        if (!files) return res.status(404).send('');
        
        console.log(files);
    });
});

// file delete
app.get('/file/delete/:id',function(req, res){
    
    var file_id = req.param('id');

    gfs.remove({ _id : file_id }, function (err, gridStore) {
        if (err) return handleError(err);
        console.log('success');
    });
});


//file download
app.get('/file/download/:id',function(req, res){

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
app.all('/file/upload',function(req,res){

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

// app listen
app.listen(port, function () {
    console.log('REST API listening on ' + appEnv.url + ':' + port);
});