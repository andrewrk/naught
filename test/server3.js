var http, text, prefix;

http = require("http");

function logIt(stream, text, cb) {
  var flushed;
  if (stream.write(text + "\n")) {
    cb()
  } else {
    stream.once('drain', cb)
  }
  if (flushed) {
    cb();
  } else {
    stream.once('drain', cb);
  }
}

text = "abcdefghijklmnopqrstuvwxyz123456789101121314151617181920"
console.log("server3 attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/hi") {
    resp.end("server3 " + process.env.hi);
  } else if (req.url === "/stdout") {
    prefix = "3 stdout ";
    logIt(process.stdout, prefix + text, function() {
      logIt(process.stdout, prefix + text, function() {
        resp.end("stdout3")
      })
    })
  } else if (req.url === "/stderr") {
    prefix = "3 stderr ";
    logIt(process.stderr, prefix + text, function () {
      logIt(process.stderr, prefix + text, function() {
        resp.end("stderr3")
      })
    })
  }
}).listen(process.env.PORT, function() {
  console.error("server3 listening");
  process.send("online");
});
