var http, util;

http = require("http");
util = require("util");

console.log("stdout: attempting to listen");
console.log("port", process.env.PORT, "hi", process.env.hi);
http.createServer(function(req, resp) {
  if (req.url === "/die") {
    throw new Error("unhandled exception");
  } else if (req.url === "/hi") {
    resp.end(process.env.hi);
  } else {
    resp.end('<html><head></head><body><p>hi</p></body></html>');
  }
}).listen(process.env.PORT, function() {
  console.error("stderr: listening");
  process.send("online");
});
