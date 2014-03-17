var http;

http = require("http");

console.log("server2 attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/hi") {
    resp.end("server2 " + process.env.hi);
  } else if (req.url === "/cwd") {
    resp.end(process.cwd());
  }
}).listen(process.env.PORT, function() {
  console.error("server2 listening");
  process.send("online");
});
