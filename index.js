#!/usr/bin/env js
'use strict';
 
var fs = require('fs');
var asbs = require('asbs-lib');
 
var packageData = JSON.parse(fs.readFileSync('./package.json'));
 
var ArgumentParser = require('argparse').ArgumentParser;
var parser = new ArgumentParser({
  version: packageData.version,
  addHelp: true,
  description: packageData.description
});
parser.addArgument( [ '-H', '--host' ], { help: 'IP or hostname of the game server to connect to.' } );
parser.addArgument( [ '-p', '--port' ], { help: 'TCP port of the game server to connect to (defaults to 2010).' , defaultValue: 2010} );
parser.addArgument( [ '-s', '--ship' ], { help: 'Ship index, 1 to 8 (defaults to 1)', defaultValue: 1 } );
parser.addArgument( [ '-l', '--local' ], { help: 'Local IP address to connect from, use only when several (virtual) network interfaces are present.' } );

var args = parser.parseArgs();
args.ship = parseInt(args.ship,10);

function radiansToHeading(rads) {
	// Heading is -Math.PI for 0, 0 for 180, and +Math.PI for 360.
	return (rads / 2 / Math.PI * 360) + 180;
}

var ship = {};
var shipName = '';
var shipID = null;

var sock = new asbs.Socket();


// Shorthand functions

function sendComm(str){
	if (!shipName) return;
	console.log("Sending message from ship ", shipName, ": ", str);
	sock.send('gameMasterMessage', {
		destination:0, 
		sender: shipName,
		msg: str
	});
}


function setImpulse(throttle) {
	setWarp(0);
	if (ship.throttle !== throttle) {
		sock.send('setImpulse',{throttle: throttle});
		ship.throttle = throttle;
	}
}

function setWarp(warp) {
	if (ship.warp !== warp) {
		if (warp)
			sendComm('Autopilot engaging warp factor ' + warp);
		if (!warp)
			sendComm('Autopilot disengaging warp');
		sock.send('setWarp', {warpFactor: warp});
		
	}
}


function setRudder(rudder) {
	if (ship.rudder !== rudder) {
		sock.send('setRudder',{rudder: rudder});
		ship.rudder = rudder;
	}
}

function centerRudder() { setRudder(0.5); }
function turnLeft()     { 
	if (ship.rudder !== 0.0) sendComm('Autopilot turning hard starboard');
	setWarp(0);
	setRudder(0.0); 
}
function turnRight()    { 
	if (ship.rudder !== 1.0) sendComm('Autopilot turning hard port');
	setWarp(0);
	setRudder(1.0); 
}

function init() {
	shipID = null;
	ship = {};
	setImpulse(1.0);
	var rudder = 0.4 + Math.random() * 0.2;
	console.log('Setting rudder to ', rudder);
	setRudder( rudder );
// 	sock.send('setMainScreen',{view: 'longRange'});
}







sock.on('connect', function(){
	sock.send('setPlayerShipIndex', {playerShipIndex: args.ship -1 });
	sock.send('setConsole',{console: 'helm' , selected: true});
	sock.send('setConsole',{console: 'gameMaster' , selected: true});
	sock.send('setReady',{});
	init();
});

sock.on('difficulty', init);

sock.on('allPlayerShipsSettings', function(data){
	
	shipName = data[ args.ship ].name;
	console.log('The name of my ship is ', shipName);
	
});

sock.on('remove', function(data){
	if (data.type === 'player' && data.id === shipID) {
		sendComm("We've been destroyed!");
		init();
	}
	
});

sock.on('playerShip', function(update) {
	
	if (shipID !== null && update.id !== shipID) return;

	if ('playerShipIndex' in update.data) {
		console.log('shipindex %d is ID %d (mine is %d)', update.data.playerShipIndex, update.id, args.ship);
		
		if (update.data.playerShipIndex != args.ship) return;
		if (!shipID) {
			shipID = update.id;
		}
	}
	if (!shipID) {
		console.log("I don't know my ship ID yet.");
		return;
	}
	
	for (var i in update.data) {
		ship[i] = update.data[i];
	}
	
	var hdg = radiansToHeading(ship.heading);
	var x = ship.posX;
	var z = ship.posZ;
	
	
	if (x > 90000) {	// Too far west/left
		
		if (hdg > 45 && hdg < 135) {
			// It's okay, we're going south, center rudder
			centerRudder();
		} else if (hdg < 45 || hdg > 270) {
			turnRight();
		} else {
			turnLeft();
		}
		
	} else if (x < 10000) { // Too far east/right
		if (hdg > 225 && hdg < 315) { centerRudder(); }
		else if (hdg > 45 && hdg < 225) { turnRight();}
		else { turnLeft();}
	} else if (z < 10000) { // Too far north/up
		if (hdg > 135 && hdg < 225) { centerRudder(); }
		else if (hdg < 135) { turnRight();}
		else { turnLeft();}
	} else if (z > 90000) { // Too far south/down
		if (hdg > 315 || hdg < 45) { centerRudder(); }
		else if (hdg > 180) { turnRight();}
		else { turnLeft();}
	}
	
	

	if (ship.energy < 500 && ship.throttle > 0.0) {
		setImpulse(0.0);
	} else if (ship.energy > 900 && ship.rudder > 0.4 && ship.rudder < 0.6) {
		setWarp(1);
	} else if (ship.energy > 750 && ship.throttle < 1.0) {
		setImpulse(1.0);
	}
	
	console.log('ID: %d, ENE: %d, WRP: %d, IMP: %d, RUD: %d, VEL: %d, HDG: %d, X: %d, Z: %d', 
		    Math.round(update.id), 
		    Math.round(ship.energy), 
		    Math.round(ship.warp), 
		    Math.round(ship.impulseSpeed * 100) / 100, 
		    Math.round(ship.rudder * 100) / 100, 
		    Math.round(ship.velocity * 100) / 100, 
		    Math.round(hdg), 
		    Math.round(x), 
		    Math.round(z)
	);
	
// 	console.dir(ship);
// 	if (Object.keys(update.data).length > 10) {
// 		console.dir(update.data);
// 	}
});

sock.on('error', function(err) {
	console.error(err);
});

sock.on('unparsed', function(err) {
	console.error(err.toString());
	console.error(err.stack);
});

sock.connect({ 
	host: args.host, 
	port: args.port,
	localAddress: args.local
});

