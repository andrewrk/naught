[![Build Status](https://secure.travis-ci.org/andrewrk/naught.png)](http://travis-ci.org/andrewrk/naught)

Features:
---------

 * Zero downtime code deployment
 * Ability to gracefully handle uncaught exceptions
 * Resuscitation - when a worker dies it is restarted
 * Redirect worker stdout and stderr to rotating gzipped log files
 * Runs as daemon, providing ability to start and stop
 * Clustering - take advantage of multiple CPU cores
 * Properly handles SIGTERM and SIGHUP for integration with service wrappers
 * Supports POSIX operating systems (does not support Windows)
 * Supports using sockets opened by systemd or launchd

Usage:
------

To use naught, your node.js server has 2 requirements.

1. Once the server is fully booted and is readily accepting connections,

   ```js
   process.send('online');
   ```

   Usually this is done in the `listening` event for a node server, for
   example:

   ```js
   server = http.createServer(...);
   server.listen(80, function () {
     if (process.send) process.send('online');
   });
   ```

2. Listen to the `shutdown` message and shutdown gracefully. This message
   is emitted after there is already a newer instance of your server
   online and taking care of business:

   ```js
   process.on('message', function(message) {
     if (message === 'shutdown') {
       performCleanup();
       process.exit(0);
     }
   });
   ```

   If your server has no long-lived connections, you may skip this step.
   However, note that most node.js apps do have long lived connections.
   In fact, by default, the connection: keep-alive header is sent with
   every request.

   When you receive the `shutdown` message, either close all open
   connections or call `process.exit()`.

Gracefully Handling Exceptions
------------------------------

Another way you can use naught is to gracefully handle exceptions that would
normally cause errors for users other than the one that triggered the
exception.

It is common practice to allow an uncaught exception to crash the Node.js
process. In the case of a web server, that forcefully ends the execution
of all other connections, resulting in more than a single user getting an
error.

Using naught a worker can use the 'offline' message to announce that it is
dying. At this point, naught prevents it from accepting new connections and
spawns a replacement worker, allowing the dying worker to finish up with
its current connections and do any cleanup necessary before finally perishing.

To take advantage of this, you need a way of catching the uncaught exceptions
that cause crashes. There are two ways:

 * [Domains](http://nodejs.org/api/domain.html)
 * [uncaughtException](http://nodejs.org/api/process.html#process_event_uncaughtexception)

The documentation says to use Domains, so use that unless you have a better
reason.

The below example assumes this is for an express app. If it is not, suit it to
your needs.

1. Setup domain.

   An easy way is to use [express-domain-errors](https://npmjs.org/package/express-domain-errors)
   
2. Send offline message to naught from the domain error handler

   ```js
   var domainError = require('express-domain-errors');
   var domain = require('domain');
   var serverDomain = domain.create();
   var gracefulExit = require('express-graceful-exit');
   var express = require('express');
   var app;
   ```

   ```js
   function sendOfflineMsg() {
     if (process.send) process.send('offline')
   }

   function doGracefulExit(err) {
     gracefulExit.gracefulExitHandler(app, server)
   }

   serverDomain.run(function() {
     app = express()

     app.use(domainError(sendOfflineMsg, doGracefulExit))

     // Setup app as normal
     // ...

     server = app.listen(process.env.PORT || 8000)
     server.on('listening', function() {
        if (process.send) process.send('online')
     })
   })
   ```

Tip:
----

If you want to deploy on a restricted port such as 80 or 443 without sudo, try
[authbind](http://www.debian-administration.org/articles/386).

Note that there are 3 layers of process spawning between the naught CLI
and your server. So you'll want to use the `--deep` option with authbind.

Using a service wrapper:
------------------------

It may make sense to use naught with other process monitoring software.
For this reason, naught supports listening to SIGTERM to do a `stop`
operation, and SIGHUP to do a `deploy` operation. You may also run
in the foregroun with `--daemon-mode false`.

When you run with `--daemon-mode true` (the default), the process tree looks
like this:

 * CLI process, spawns the following (detached) and then exits:
   * daemon process, listens for SIGTERM/SIGHUP, spawns the following and
     stays running:
     * cluster master process, spawns the following and stays running:
         * worker 1
         * worker 2
         * etc

When you run with `--daemon-mode false`, the process tree looks like this:

 * CLI process, listens for SIGTERM/SIGHUP, spawns the following and stays
   running:
   * cluster master process, spawns the following and stays running:
     * worker 1
     * worker 2
     * etc

Using a socket from systemd or launchd
--------------------------------------

When using naught from systemd or launchd, you must use `--daemon-mode false`.

systemd and launchd can be configured to listen on a port and launch naught
when a connection is detected on that port. The intention is that your server
will only run when it is actually needed. systemd or launchd will provide the
open socket to naught on a file descriptor, and naught will pass that file
descriptor on to your server as it launches it. naught will set the
`LISTEN_FD` environment variable to the number of the file descriptor on
which your server should listen, which it could do like this:

   ```js
   server.listen(process.env.LISTEN_FD ? {fd: parseInt(process.env.LISTEN_FD, 10)} : (process.env.PORT || 8000));
   ```

naught automatically detects if it was launched by systemd and passes the
socket along. For use from launchd, pass the `--launchd-socket` flag when
starting naught, and provide the name of the key you defined in the Sockets
dictionary in your server's launchd plist. Here is a sample plist:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
     <dict>
       <key>EnvironmentVariables</key>
       <dict>
         <key>NODE_ENV</key>
         <string>production</string>
         <key>PATH</key>
         <string>/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
       </dict>
       <key>Label</key>
       <string>com.example.myserver</string>
       <key>ProgramArguments</key>
       <array>
         <string>/usr/local/bin/node</string>
         <string>node_modules/.bin/naught</string>
         <string>start</string>
         <string>--daemon-mode</string>
         <string>false</string>
         <string>--launchd-socket</string>
         <string>Listeners</string>
         <string>server.js</string>
       </array>
       <key>Sockets</key>
       <dict>
         <key>Listeners</key>
         <dict>
           <key>SockFamily</key>
           <string>IPv4v6</string>
           <key>SockServiceName</key>
           <integer>8000</integer>
         </dict>
       </dict>
       <key>WorkingDirectory</key>
       <string>/opt/myserver</string>
     </dict>
   </plist>
   ```

If you want to pass a socket in a file descriptor to naught started from some
process other than systemd or launchd, you can set the LISTEN_FD environment
variable to the file descriptor number when you launch naught.

CLI:
----

    naught start [options] server.js [script-options]

        Starts server.js as a daemon passing script-options as command
        line arguments.

        Each worker's stdout and stderr are redirected to a log files
        specified by the `stdout` and `stderr` parameters. When a log file
        becomes larger than `max-log-size`, the log file is renamed using the
        current date and time, and a new log file is opened.

        With naught, you can use `console.log` and friends. Because naught
        pipes the output into a log file, node.js treats stdout and stderr
        as asynchronous streams.

        If you don't want a particular log, use `/dev/null` for the path. Naught
        special cases this filename and disables that log altogether.

        When running in `daemon-mode` `false`, naught will start the master
        process and then block. It listens to SIGHUP for restarting and SIGTERM
        for stopping. In this situation you may use `-` for `stderr` and/or
        `stdout` which will redirect the respective streams to naught's output
        streams instead of a log file.

        Creates an `ipc-file` which naught uses to communicate with your
        server once it has started.

        Available options and their defaults:

        --worker-count 1
        --ipc-file naught.ipc
        --pid-file naught.pid
        --log naught.log
        --stdout stdout.log
        --stderr stderr.log
        --max-log-size 10485760
        --cwd .
        --daemon-mode true
        --remove-old-ipc false
        --node-args ''
        --launchd-socket ''


    naught stop [options] [ipc-file]

        Stops the running server which created `ipc-file`.
        Uses `naught.ipc` by default.

        This sends the 'shutdown' message to all the workers and waits for
        them to exit gracefully.

        If you specify a timeout, naught will forcefully kill your workers
        if they do not shut down gracefully within the timeout.

        Available options and their defaults:

            --timeout none
            --pid-file naught.pid


    naught status [ipc-file]

        Displays whether a server is running or not.
        Uses `naught.ipc` by default.


    naught deploy [options] [ipc-file]

        Replaces workers with new workers using new code and optionally
        the environment variables from this command.

        Naught spawns all the new workers and waits for them to all become
        online before killing a single old worker. This guarantees zero
        downtime if any of the new workers fail and provides the ability to
        cleanly abort the deployment if it hangs.

        A hanging deploy happens when a new worker fails to emit the 'online'
        message, or when an old worker fails to shutdown upon receiving the
        'shutdown' message. A keyboard interrupt will cause a deploy-abort,
        cleanly and with zero downtime.

        If `timeout` is specified, naught will automatically abort the deploy
        if it does not finish within those seconds.

        If `override-env` is true, the environment varibables that are set with
        this command are used to override the original environment variables
        used with the `start` command. If any variables are missing, the
        original values are left intact.

        `worker-count` can be used to change the number of workers running. A
        value of `0` means to keep the same number of workers.

        `cwd` can be used to change the cwd directory of the master process.
        This allows you to release in different directories. Unfortunately,
        this option doesn't update the script location. For example, if you
        start naught `naught start --cwd /release/1 server.js` and deploy
        `naught deploy --cwd /release/2` the script file will not change from
        '/release/1/server.js' to '/release/2/server.js'. You have to create
        a symlink and pass the full symlink path to naught start
        '/current/server.js'. After creating the symlink naught starts the
        correct script, but the cwd is still old and require loads files from
        from the old directory. The cwd option allows you to update the cwd
        to the new directory. It defaults to naught's cwd.

        Uses `naught.ipc` by default.

        Available options and their defaults:

            --worker-count 0
            --override-env true
            --timeout none
            --cwd .


    naught deploy-abort [ipc-file]

        Aborts a hanging deploy. A hanging deploy happens when a new worker
        fails to emit the 'online' message, or when an old worker fails
        to shutdown upon receiving the 'shutdown' message.

        When deploying, a keyboard interrupt will cause a deploy-abort,
        so the times you actually have to run this command will be few and
        far between.

        Uses `naught.ipc` by default.


    naught version

        Prints the version of naught and exits.


    naught help [cmd]

        Displays help for cmd.
