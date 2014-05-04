var http, server;

http = require("http");

console.log("server6 attempting to listen");
server = http.createServer(function(req, resp) {
  if (req.url === "/offline") {
    process.send("offline");
    resp.end("Going offline");
    server.close(function() {
      setTimeout(process.exit.bind(this, 0), 200);
    });
  } else if (req.url === "/double-offline") {
    process.send("offline");
    resp.end("Not really going offline");
    setTimeout(function() {
      process.send("offline")
    }, 200)
  }
});

server.listen(process.env.PORT, function() {
  console.error("server6 listening");
  process.send("online");
});

