var cluster, assert, async, argv, worker_count, script, workers, worker_status, waiting_for, i;
cluster = require('cluster');
assert = require('assert');
async = require('async');
argv = process.argv.slice(2);
worker_count = parseInt(argv.shift());
script = argv.shift();
cluster.setupMaster({
  exec: script,
  args: argv
});
workers = {
  booting: newWorkerCollection(),
  online: newWorkerCollection(),
  dying: newWorkerCollection(),
  new_booting: newWorkerCollection(),
  new_online: newWorkerCollection()
};
worker_status = {};
waiting_for = null;
process.on('message', function(message){
  var timer, timeout;
  switch (message.action) {
  case 'NaughtDeploy':
    import$(process.env, message.environment);
    timer = null;
    deployStart(function(){
      if (timer != null) {
        clearTimeout(timer);
      }
    });
    if ((timeout = message.timeout) != null) {
      timer = wait(timeout, function(){
        timer = null;
        deployAbort();
      });
    }
    break;
  case 'NaughtDeployAbort':
    deployAbort();
    break;
  case 'NaughtShutdown':
    shutdownAll(function(){
      if (timer != null) {
        clearTimeout(timer);
      }
      process.exit(0);
    });
    if ((timeout = message.timeout) != null) {
      timer = wait(timeout, function(){
        timer = null;
        destroyAll();
      });
    }
    break;
  case 'NaughtStatus':
    event('Status');
    break;
  default:
    event('UnrecognizedMessage');
  }
});
for (i = 0; i < worker_count; ++i) {
  addWorker('booting', makeWorker());
}
event('Bootup');
function wait(seconds, cb){
  return setTimeout(cb, seconds * 1000);
}
function newWorkerCollection(){
  return {
    hash: {},
    count: 0
  };
}
function setWorkerStatus(worker, status){
  addWorker(status, removeWorker(worker.process.pid));
}
function addWorker(status, worker){
  var pid, collection, hash;
  pid = worker.process.pid;
  worker_status[pid] = status;
  collection = workers[status];
  hash = collection.hash;
  if (!(pid in hash)) {
    collection.count += 1;
  }
  hash[pid] = worker;
}
function removeWorker(pid){
  var status, collection, hash, ref$;
  status = worker_status[pid], delete worker_status[pid];
  collection = workers[status];
  hash = collection.hash;
  assert(pid in hash);
  collection.count -= 1;
  return ref$ = hash[pid], delete hash[pid], ref$;
}
function shiftWorker(status){
  var pid;
  for (pid in workers[status].hash) {
    return removeWorker(pid);
  }
  return assert(false);
}
function forEachWorker(status, cb){
  var collection, pid, ref$, worker;
  collection = workers[status];
  for (pid in ref$ = collection.hash) {
    worker = ref$[pid];
    cb(pid, worker);
  }
}
function onceOnline(worker, cb){
  worker.on('message', onMessage);
  function onMessage(message){
    if (message === 'online') {
      worker.removeListener('message', onMessage);
      cb();
    }
  }
}
function makeWorker(){
  var worker;
  worker = cluster.fork();
  worker.once('exit', function(){
    if (waiting_for != null) {
      return;
    }
    removeWorker(worker.process.pid);
    addWorker('booting', makeWorker());
    event('WorkerDeath');
  });
  if (waiting_for == null) {
    onceOnline(worker, function(){
      setWorkerStatus(worker, 'online');
      event('WorkerOnline');
      if (workers.booting.count === 0) {
        event('Ready');
      }
    });
  }
  return worker;
}
function event(name){
  process.send({
    count: {
      booting: workers.booting.count,
      online: workers.online.count,
      dying: workers.dying.count,
      new_booting: workers.new_booting.count,
      new_online: workers.new_online.count
    },
    waiting_for: waiting_for,
    event: name
  });
}
function spawnNew(cb){
  var new_worker;
  assert(workers.new_booting.count < worker_count);
  addWorker('new_booting', new_worker = makeWorker());
  event('SpawnNew');
  onceOnline(new_worker, function(){
    setWorkerStatus(new_worker, 'new_online');
    event('NewOnline');
    cb();
  });
}
function shutdownOneWorker(status){
  return function(cb){
    var collection, dying_worker;
    collection = workers[status];
    assert(collection.count > 0);
    addWorker('dying', dying_worker = shiftWorker(status));
    event('ShutdownOld');
    dying_worker.disconnect();
    dying_worker.send('shutdown');
    dying_worker.once('exit', function(){
      removeWorker(dying_worker.process.pid);
      event('OldExit');
      cb();
    });
  };
}
function deployStart(cb){
  var i;
  if (waiting_for === 'shutdown') {
    event('ErrorShuttingDown');
    return cb();
  } else if (waiting_for != null) {
    event('ErrorDeployInProgress');
    return cb();
  } else if (workers.booting.count > 0) {
    event('ErrorStillBooting');
    return cb();
  }
  waiting_for = 'new';
  async.parallel((function(){
    var to$, results$ = [];
    for (i = 0, to$ = worker_count; i < to$; ++i) {
      results$.push(spawnNew);
    }
    return results$;
  }()), function(){
    var i;
    assert(workers.new_online.count === worker_count);
    waiting_for = 'old';
    async.parallel((function(){
      var to$, results$ = [];
      for (i = 0, to$ = worker_count; i < to$; ++i) {
        results$.push(shutdownOneWorker('online'));
      }
      return results$;
    }()), function(){
      assert(workers.online.count === 0);
      assert(workers.dying.count === 0);
      waiting_for = null;
      forEachWorker('new_online', function(pid, worker){
        setWorkerStatus(worker, 'online');
      });
      event('Ready');
      cb();
    });
  });
}
function destroyWorkers(status){
  return function(cb){
    var new_worker;
    new_worker = shiftWorker(status);
    event('DestroyNew');
    new_worker.once('exit', cb);
    new_worker.destroy();
  };
}
function deployAbort(){
  var res$, i, to$, online, booting;
  switch (waiting_for) {
  case 'new':
    res$ = [];
    for (i = 0, to$ = workers.new_online.count; i < to$; ++i) {
      res$.push(destroyWorkers('new_online'));
    }
    online = res$;
    res$ = [];
    for (i = 0, to$ = workers.new_booting.count; i < to$; ++i) {
      res$.push(destroyWorkers('new_booting'));
    }
    booting = res$;
    async.parallel(online.concat(booting), function(){
      waiting_for = null;
      event('Ready');
    });
    break;
  case 'old':
    destroyDying();
    break;
  default:
    event('ErrorNoDeployInProgress');
  }
}
function shutdownAll(cb){
  var fns, i$, ref$, len$, status, i, to$;
  waiting_for = 'shutdown';
  fns = [];
  for (i$ = 0, len$ = (ref$ = ['booting', 'online', 'new_booting', 'new_online']).length; i$ < len$; ++i$) {
    status = ref$[i$];
    for (i = 0, to$ = workers[status].count; i < to$; ++i) {
      fns.push(shutdownOneWorker(status));
    }
  }
  async.parallel(fns, cb);
}
function destroyDying(){
  forEachWorker('dying', function(pid, dying_worker){
    event('DestroyOld');
    dying_worker.destroy();
  });
}
function destroyAll(){
  assert(workers.online.count === 0);
  assert(workers.new_booting.count === 0);
  assert(workers.new_online.count === 0);
  assert(workers.booting.count === 0);
  destroyDying();
}
function import$(obj, src){
  var own = {}.hasOwnProperty;
  for (var key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}