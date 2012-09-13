var http;

http = require("http");

http.createServer(function(req, resp) {
  if (req.path === "/die") {
    throw new Error("unhandled exception");
  } else {
    resp.end("hi");
  }
}).listen(11904);
