exports.create = create;

var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var zlib = require('zlib');

// cb(err, log)
//   log.write(str, cb)
//     cb(err)
function create(filePath, maxSize, cb) {
  createStream(filePath, onHaveStream);

  function onHaveStream(err, stream, size) {
    if (err) return cb(err);
    var pending = null;
    var log = new EventEmitter();
    stream.on('error', function(err) {
      log.emit('error', err);
    });
    log.write = logWrite;
    cb(null, log);
    function logWrite(str) {
      var flushed = stream.write(str);
      size += str.length;
      if (pending === 'flush') {
        if (flushed) {
          pending = null;
        } else {
          stream.once('drain', function() {
            pending = null;
          });
        }
      }
      if (pending == null && size >= maxSize) {
        pending = 'rename';
        var archiveName = getArchiveName(filePath);
        fs.rename(filePath, archiveName, function(err){
          if (err) return log.emit('error', err);
          createStream(filePath, function(err, newStream, newSize){
            if (err) return log.emit('error', err);
            stream.once('close', function() {
              var gzip = zlib.createGzip();
              var inp = fs.createReadStream(archiveName);
              var out = fs.createWriteStream(archiveName + ".gz");
              inp.on('error', function(err) {
                return log.emit('error', err);
              });
              out.on('error', function(err){
                return log.emit('error', err);
              });
              inp.pipe(gzip).pipe(out);
              out.once('close', function(){
                fs.unlink(archiveName, function(err){
                  if (err) return log.emit('error', err);
                });
              });
            });
            stream.end();
            newStream.on('error', function(err) {
              return log.emit('error', err);
            });
            size = newSize;
            stream = newStream;
            pending = 'flush';
          });
        });
      }
    }
  }
}
function getFileSize(filePath, cb){
  fs.stat(filePath, function(err, stats){
    if (err) {
      if (err.code === 'ENOENT') {
        return cb(null, 0);
      } else {
        return cb(err);
      }
    } else {
      cb(null, stats.size);
    }
  });
}
function createStream(filePath, cb){
  mkdirp(path.dirname(filePath), function(err){
    if (err) return cb(err);
    getFileSize(filePath, function(err, size){
      if (err) return cb(err);
      var stream = fs.createWriteStream(filePath, {
        flags: 'a'
      });
      cb(null, stream, size);
    });
  });
}
function getArchiveName(filePath){
  var dirname = path.dirname(filePath);
  var extname = path.extname(filePath);
  var basename = path.basename(filePath, extname);
  var timestamp = new Date().getTime();
  return path.join(dirname, basename + "-" + timestamp + extname);
}
