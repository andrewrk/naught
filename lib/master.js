var cluster = require('cluster')
  , assert = require('assert')
  , async = require('async')

  , argv = process.argv.slice(2)
  , workerCount = parseInt(argv.shift(), 10)
  , script = argv.shift()

  , own = {}.hasOwnProperty
  , statusesToShutdown = ['booting', 'online', 'new_online'];


cluster.setupMaster({
  exec: script,
  args: argv
});
var workers = {
  // workers go here until they all have emitted 'online'
  booting: newWorkerCollection(),
  // workers move from here to 'dying' when we ask them to 'shutdown'
  online: newWorkerCollection(),
  // workers in here have been asked to 'shutdown'
  dying: newWorkerCollection(),
  // these are online workers ready to replace old workers
  new_online: newWorkerCollection()
};
var messageHandlers = {
  'NaughtDeploy': onNaughtDeploy,
  'NaughtDeployAbort': onNaughtDeployAbort,
  'NaughtShutdown': onNaughtShutdown,
  'NaughtStatus': onNaughtStatus,
};
var workerStatus = {};
var waitingFor = null;

process.on('message', dispatchMessage);

event('Bootup');
deployStart(function() {
  if (workers.online.count === workerCount) {
    event('Ready');
  } else {
    process.nextTick(function() {
      process.exit(1);
    });
  }
});

function dispatchMessage(message) {
  var handler = messageHandlers[message.action];
  if (handler) {
    handler(message);
  } else {
    event('UnrecognizedMessage');
  }
}

function onNaughtDeployAbort(message) {
  deployAbort(function() {
    event('Ready');
  });
}

function onNaughtDeploy(message) {
  extend(process.env, message.environment);
  var timer = null;
  deployStart(function(eventName){
    if (timer != null) clearTimeout(timer);
    event(eventName);
  });
  var timeout = message.timeout;
  if (timeout != null) {
    timer = wait(timeout, function(){
      timer = null;
      event('Timeout');
      deployAbort(function() {
        event('DeployFailed');
      });
    });
  }
}

function onNaughtShutdown(message) {
  var timer = null;
  shutdownAll(function(aborted){
    if (timer != null) clearTimeout(timer);
    process.exit(0);
  });
  var timeout = message.timeout;
  if (timeout != null) {
    timer = wait(timeout, function(){
      timer = null;
      event('Timeout');
      destroyAll();
    });
  }
}

function onNaughtStatus(message) {
  event('Status');
}
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
  var pid = worker.process.pid;
  workerStatus[pid] = status;
  var collection = workers[status];
  var hash = collection.hash;
  if (!(pid in hash)) {
    collection.count += 1;
  }
  hash[pid] = worker;
}
function removeWorker(pid){
  var status = workerStatus[pid];
  delete workerStatus[pid];
  var collection = workers[status];
  var hash = collection.hash;
  assert(pid in hash);
  collection.count -= 1;
  var worker = hash[pid];
  delete hash[pid];
  return worker;
}

function shiftWorker(status){
  for (var pid in workers[status].hash) {
    return removeWorker(pid);
  }
  assert(false);
}

function forEachWorker(status, cb){
  var collection = workers[status];
  for (var pid in collection.hash) {
    cb(pid, collection.hash[pid]);
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
  var worker = cluster.fork();
  var expectedExit = false;
  worker.on('message', onMessage);
  worker.on('exit', onExit);
  if (waitingFor == null) {
    // this code activates when a server crashes during normal operations;
    // no deploy is in progress
    onceOnline(worker, function(){
      setWorkerStatus(worker, 'online');
      event('WorkerOnline');
      if (workers.booting.count === 0) event('Ready');
    });
  }
  return worker;

  function onMessage(message){
    if (message === 'offline') {
      // worker declared itself offline. we're treating it as
      // if it just now crashed.
      expectedExit = true;

      setWorkerStatus(worker, 'dying');
      event('WorkerOffline');

      addWorker('booting', makeWorker());
      event('SpawnNew');
    }
  }
  function onExit() {
    // ignore if this happened due to a deployment
    if (waitingFor != null) return;
    removeWorker(worker.process.pid);
    if (!expectedExit) {
      addWorker('booting', makeWorker());
    }
    event('WorkerDeath');
  }
}

function event(name){
  process.send({
    count: {
      booting: workers.booting.count,
      online: workers.online.count,
      dying: workers.dying.count,
      new_online: workers.new_online.count
    },
    waitingFor: waitingFor,
    event: name
  });
}

function spawnNew(cb){
  assert(workers.booting.count < workerCount);
  var newWorker = makeWorker();
  addWorker('booting', newWorker);
  event('SpawnNew');
  newWorker.on('exit', onExit);
  onceOnline(newWorker, function(){
    newWorker.removeListener('exit', onExit);
    setWorkerStatus(newWorker, 'new_online');
    event('NewOnline');
    cb();
  });
  function onExit() {
    // worker crashed before going online
    removeWorker(newWorker.process.pid);
    event('NewDeath');
    cb();
  }
}
function shutdownOneWorker(status){
  return function(cb){
    var collection = workers[status];
    assert(collection.count > 0);
    var dyingWorker = shiftWorker(status);
    addWorker('dying', dyingWorker);
    event('ShutdownOld');
    dyingWorker.removeAllListeners('exit');
    dyingWorker.on('exit', onExit);
    var handledOnExit = false;
    try {
      dyingWorker.disconnect();
      dyingWorker.send('shutdown');
    } catch (err) {
      onExit();
    }
    function onExit() {
      if (handledOnExit) return;
      handledOnExit = true;
      removeWorker(dyingWorker.process.pid);
      event('OldExit');
      cb();
    }
  };
}
function deployStart(cb){
  if (waitingFor === 'shutdown') {
    return cb('ErrorShuttingDown');
  } else if (waitingFor != null) {
    return cb('ErrorDeployInProgress');
  }
  assert.ok(workers.booting.count === 0);
  waitingFor = 'new';
  var createNewWorkerFns = [];
  for (var i = 0; i < workerCount; ++i) {
    createNewWorkerFns.push(spawnNew);
  }
  async.parallel(createNewWorkerFns, function(){
    if (workers.new_online.count !== workerCount) {
      deployAbort(function() {
        cb('DeployFailed');
      });
      return;
    }
    waitingFor = 'old';
    var shutdownOneWorkerFns = [];
    for (var i = 0; i < workers.online.count; ++i) {
      shutdownOneWorkerFns.push(shutdownOneWorker('online'));
    }
    async.parallel(shutdownOneWorkerFns, function(){
      assert(workers.online.count === 0);
      assert(workers.dying.count === 0);
      waitingFor = null;
      forEachWorker('new_online', function(pid, worker){
        setWorkerStatus(worker, 'online');
      });
      cb('Ready');
    });
  });
}

function destroyWorkers(status){
  return function(cb){
    var newWorker = shiftWorker(status);
    event('DestroyNew');
    newWorker.removeAllListeners('exit');
    newWorker.once('exit', function() {
      event('NewDestroyed');
      cb();
    });
    newWorker.destroy();
  };
}

function deployAbort(cb){
  switch (waitingFor) {
  case 'new':
    var destroyFns = [];
    var i;
    for (i = 0; i < workers.new_online.count; ++i) {
      destroyFns.push(destroyWorkers('new_online'));
    }
    for (i = 0; i < workers.booting.count; ++i) {
      destroyFns.push(destroyWorkers('booting'));
    }
    async.parallel(destroyFns, function(){
      waitingFor = null;
      cb();
    });
    break;
  case 'old':
    destroyDying();
    cb();
    break;
  default:
    event('ErrorNoDeployInProgress');
  }
}

function shutdownAll(cb){
  if (waitingFor === 'shutdown') {
    event('AlreadyShuttingDown');
    return;
  }
  waitingFor = 'shutdown';
  var fns = [];
  statusesToShutdown.forEach(function(status) {
    var count = workers[status].count;
    for (var i = 0; i < count; ++i) {
      fns.push(shutdownOneWorker(status));
    }
  });
  async.parallel(fns, cb);
}
function destroyDying(){
  forEachWorker('dying', function(pid, dyingWorker){
    event('DestroyOld');
    dyingWorker.destroy();
  });
}
function destroyAll(){
  assert(workers.online.count === 0);
  assert(workers.new_online.count === 0);
  assert(workers.booting.count === 0);
  destroyDying();
}

function extend(obj, src){
  for (var key in src) {
    if (own.call(src, key)) obj[key] = src[key];
  }
  return obj;
}
