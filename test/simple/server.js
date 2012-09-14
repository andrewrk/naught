var http;

http = require("http");

console.log("stdout: attempting to listen");
http.createServer(function(req, resp) {
  if (req.path === "/die") {
    throw new Error("unhandled exception");
  } else {
    resp.end("hi");
  }
}).listen(11904, function() {
  console.error("stderr: listening");
});
