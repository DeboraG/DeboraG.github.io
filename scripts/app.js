// Derived from voice-change-o-matic demo
// See https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API
// https://github.com/mdn/voice-change-o-matic
// http://mdn.github.io/voice-change-o-matic/

// fork getUserMedia for multiple browser versions, for those
// that need prefixes


// https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
// Older browsers might not implement mediaDevices at all, so we set an empty object first
if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
}

// Some browsers partially implement mediaDevices. We can't just assign an object
// with getUserMedia as it would overwrite existing properties.
// Here, we will just add the getUserMedia property if it's missing.
if (navigator.mediaDevices.getUserMedia === undefined) {
    navigator.mediaDevices.getUserMedia = function(constraints) {

        // First get hold of the legacy getUserMedia, if present
        var getUserMedia = navigator.getUserMedia ||
                       navigator.webkitGetUserMedia || 
                       navigator.mozGetUserMedia ||
                       navigator.msGetUserMedia;

        // Some browsers just don't implement it - return a rejected promise with an error
        // to keep a consistent interface
        if (!getUserMedia) {
            return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
        }

        // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
        return new Promise(function(resolve, reject) {
            getUserMedia.call(navigator, constraints, resolve, reject);
        });
    }
}


// set up forked web audio context, for multiple browsers
// window. is needed otherwise Safari explodes
var audioCtx;

try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
catch (e) {
    console.log ('Error creating audio context: ' + e.message);
    alert("Sorry, your browser does not support web audio")
}

var volSlider = document.getElementById("volslider");
var targetButton = document.getElementById("target-btn");
var modeButton = document.getElementById("mode-btn");
var shapesButton = document.getElementById("shapes-btn");

var source;
var stream;


//set up the audio node we will use for the app

var analyser = audioCtx.createAnalyser();
analyser.minDecibels = -90;
analyser.maxDecibels = -10;
analyser.smoothingTimeConstant = 0.85;

var oscillator = audioCtx.createOscillator();
oscillator.type = 'sine';
oscillator.frequency.value = 440;

var gainNode = audioCtx.createGain();
gainNode.gain.value = 0;

oscillator.connect(gainNode);
gainNode.connect(audioCtx.destination);
oscillator.start();


//var intendedWidth = document.querySelector('.canvas-div').clientWidth;

// set up canvas for staff
var canStaff = document.querySelector('.staff');
var canvasStaffCtx = canStaff.getContext("2d");

// set up canvas context for showAudior
var canvas = document.querySelector('.visualizer');
var canvasCtx = canvas.getContext("2d");

var idAnimationFrame;

//main block for doing the audio display

navigator.mediaDevices.getUserMedia({audio: true})  // constraints - only audio needed for this app
.then(function(stream) {
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    showAudio();
})
.catch(function(err) {
    console.log('The following gUM error occured: ' + err);
})


WIDTH = canvas.width;
HEIGHT = canvas.height;

// Independent parameters
analyser.fftSize = 16384;  // power of 2
// High extreme, at a minimum, for non-coloratura sopranos is C6 = 1046.5 Hz
// TYpical opera bass has a range down to E2 = 82.4069 Hz
var minHz = 80; // must be greater than 0
var maxHz = 1280;  // must be less than audioCtx.sampleRate/analyser.fftSize/2;
var refTonicHz = 261.63;      // controls lines
var colorBreakHz = 130.813;  // boundary of octaves (shown with rainbow colored bars)


// Calculated parameters
var hzPerBin = audioCtx.sampleRate / analyser.fftSize;

var minDisplayedBin;
var maxDisplayedBin;
var numDisplayedOctaves;
sizeCanvas();
var lowestOctaveTonicHz = calculateLowestOctaveTonicHz(refTonicHz);

// State variables
var majorMode = true;
var shapes4 = true;
var tonePlaying = false;

canvasStaffCtx.fillStyle = 'rgb(0, 0, 0)';
canvasStaffCtx.fillRect(0, 0, WIDTH, HEIGHT);

var canvasStaffHeight = 200;
canvasCtx.fillStyle = 'rgb(0, 0, 0)';
canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);
drawReferenceScaleImage(refTonicHz);

var dataArrayAlt = new Uint8Array(hzToBin(maxHz) + 1);


function showAudio() {

    // Relative amounts that the bars need to be scaled is logarithmic.
    // (That is, if there are N bars in the first octave, there are 2N
    // bars in the second octave, 4N bars in the third octave, etc.)
    // Since log (i * binsize) = log(i) + log(binsize)
    // and we only care about the relative differences between adjacent bins
    // don't even worry about the log(binsize) factor; we have to rescale anyway.
    var barWidth = [];
    var prevLogi = Math.log2(minDisplayedBin);
    var binSum = 0;
    for (var i = minDisplayedBin; i < maxDisplayedBin; i++) {
        var nextLogi = Math.log2(i+1);
        var binLogDiff = nextLogi - prevLogi;
        barWidth.push(binLogDiff);
        binSum += binLogDiff;
        prevLogi = nextLogi;
    }

    // normalize
    var binScale = WIDTH / binSum;
    for (var i = 0; i < maxDisplayedBin - minDisplayedBin; i++) {
        barWidth[i] *= binScale;
    }

    //canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    var drawSpectrum = function() {
        idAnimationFrame = requestAnimationFrame(drawSpectrum);

        analyser.getByteFrequencyData(dataArrayAlt);

        canvasCtx.fillStyle = 'rgb(0, 0, 0)';
        canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

        var barHeight;
        var cumWidth = 0;

        for(var i = 0; i < maxDisplayedBin - minDisplayedBin; i++) {
            binHz = binToHz(minDisplayedBin) + i * hzPerBin;
            /* TODO: refine scaling - was chosen by experiment*/
            barHeight = dataArrayAlt[i + minDisplayedBin] * HEIGHT /250;

            if (binHz >= colorBreakHz*16) {
                canvasCtx.fillStyle = 'violet';
            }
            else if (binHz >= colorBreakHz*8) {
                canvasCtx.fillStyle = 'blue';
            }
            else if (binHz >= colorBreakHz*4) {
                canvasCtx.fillStyle = "green";
            }
            else if (binHz >= colorBreakHz*2) {
                canvasCtx.fillStyle = "yellow";
            }
            else if (binHz >= colorBreakHz*1) {
                canvasCtx.fillStyle = "orange";
            }
            else {
                canvasCtx.fillStyle = "red";
            }

            canvasCtx.fillRect(cumWidth,HEIGHT-barHeight,barWidth[i],barHeight);
            cumWidth += barWidth[i];

        }

        drawTargetPitchLines(canvasCtx, HEIGHT);
        // draw lines for equal tempered scale notes
    }


    drawSpectrum();

}

canvas.onmousedown = function(e) {
    playToneFromCanvas(e);
    tonePlaying = true;
}

canvas.onmousemove = function(e) {
    if (tonePlaying) {
        playToneFromCanvas(e);
    }
}

canvas.onmouseup = function(e) {
    releaseTone();
    tonePlaying = false;
}
canvas.onmouseleave = function(e) {
    releaseTone();
    tonePlaying = false;
}

canStaff.onmousedown = function(e) {
    playToneFromCanvas(e);
    tonePlaying = true;
}

canStaff.onmousemove = function(e) {
    if (tonePlaying) {
        playToneFromCanvas(e);
    }
}

canStaff.onmouseup = function(e) {
    releaseTone();
    tonePlaying = false;
}
canStaff.onmouseleave = function(e) {
    releaseTone();
    tonePlaying = false;
}

targetButton.onclick = function(e) {
    var peakHz = getPeakFreq(dataArrayAlt);
    console.log('peakHz :'+peakHz);
    if ((peakHz > minHz) && (peakHz < maxHz)) {
        refTonicHz = peakHz;
        lowestOctaveTonicHz = calculateLowestOctaveTonicHz(refTonicHz);
        sizeCanvas();
        drawReferenceScaleImage(refTonicHz);
    }
}

modeButton.onclick = function(e) {
    if (majorMode) {
        majorMode = false;
        //document.getElementById("mode-btn").innerHTML = "Click to change to major";
       drawReferenceScaleImage(refTonicHz);
    }
    else {
        majorMode = true;
        //document.getElementById("mode-btn").innerHTML = "Click to change to minor";
        drawReferenceScaleImage(refTonicHz);
    }
}

shapesButton.onclick = function(e) {
    if (shapes4) {
        shapes4 = false;
        //document.getElementById("shapes-btn").innerHTML = "Click to change to 4 shapes";
        drawReferenceScaleImage(refTonicHz);
    }
    else {
        shapes4 = true;
        //document.getElementById("shapes-btn").innerHTML = "Click to change to 7 shapes";
        drawReferenceScaleImage(refTonicHz);
    }
}


volSlider.onchange = function() {
    console.log('slider value: '+ volSlider.value);
    gainNode.gain.value *= volSlider.value/100;
}


window.onresize = function(){ 
    window.cancelAnimationFrame(idAnimationFrame);
    //var intendedWidth = document.querySelector('.wrapper').clientWidth;
    //console.log('onresize fired, width: '+intendedWidth);
    //canvas.setAttribute('width',intendedWidth);
    sizeCanvas();
    drawReferenceScaleImage(refTonicHz);
    showAudio();
}

function sizeCanvas() {
    // clientWidth and clientHeight are the size the canvas is displayed
    // width and height are the size of the canvas's drawing buffer
    var intendedWidth = canvas.clientWidth;
    if (intendedWidth < 480)
    {
        minDisplayedBin = hzToBin(refTonicHz/2);
        maxDisplayedBin = hzToBin(refTonicHz*4) + 1;
        numDisplayedOctaves = 3;
    }
    else
    {
        minDisplayedBin = hzToBin(minHz);
        maxDisplayedBin = hzToBin(maxHz) + 1;
        numDisplayedOctaves = Math.log2(maxHz/minHz);
    }

    // log2(6) (2 octaves plus a fifth) = 2.585
    // 4 octaves is 4
    // (width * 2.585/4)/634px = height/220px
    // where staff image is 634 x 220
    // => height = width * .22425
    var intendedHeight = intendedWidth*0.22425;
    if (intendedHeight > 200)
        intendedHeight = 200;
    if (intendedHeight < 75)
        intendedHeight = 75;
    canvas.setAttribute('width',intendedWidth);
    canStaff.setAttribute('width',intendedWidth);
    canvas.setAttribute('height',intendedHeight);
    canStaff.setAttribute('height',intendedHeight);
    WIDTH=intendedWidth;
    HEIGHT=intendedHeight;

}

/**********************************************************************
                        UTILITY FUNCTIONS
 **********************************************************************/

function hzToXpos(hz) {
    return Math.log2(hz)/Math.log2(maxDisplayedBin/minDisplayedBin) * WIDTH;
}

function xposToHz(xpos) {
    return Math.pow(maxDisplayedBin/minDisplayedBin, xpos/WIDTH) * (minDisplayedBin * hzPerBin);
}

function hzToBin(hz) {
    return Math.floor(hz / hzPerBin);
}

function binToHz(bin) {
    // Add 0.5 to center in the bin
    return (bin+0.5) * hzPerBin;
}

function calculateLowestOctaveTonicHz(tonicHz) {
    // Returns up to an octave below minHz
    // Intent is to find the lowest octave that has any note lines to draw
    lowestTonicHz = tonicHz;
    while (lowestTonicHz > xposToHz(0)) {
        lowestTonicHz /= 2;
    }
    return lowestTonicHz;
}


function getPeakFreq(dataArray) {
    var peak = dataArray[0];
    var peakIndex = 0;

    for (var i = 1; i < dataArray.length; i++) {
        if (dataArray[i] > peak) {
            peakIndex = i;
            peak = dataArray[i];
        }
    }

    // Heuristic in case the harmonics have higher amplitude than the fundamental
    // Assume the fundamental is less than peak/2
    // Try several harmonics  (i/2, i/3, i/4, i/5, i/6)
    // Add a bin or two worth of slop on either side when checking for peaks
    var newPeakIndex = peakIndex;
    var slop = [0, -1, 1, -2, 2];
    for (var i = 2; i <= 6; i++) {
        foundPeak = 0;
        for (j = 0; j < slop.length; j++) {
            var testIndex = Math.floor(peakIndex/i + slop[j]);
            if ((testIndex < 0) || (testIndex >= dataArray.length))
                continue; // don't exceed array bounds
            //console.log('try (index, data): '+ testIndex +", "+dataArray[testIndex]);
            if ((dataArray[testIndex] > peak*0.6) && (dataArray[testIndex] > foundPeak)) {
                newPeakIndex = testIndex;
                foundPeak = dataArray[testIndex];
            } 
        }
    }

    // Add 0.5 to center in the peak bin
    var peakFreq = binToHz(newPeakIndex);
    console.log('Data value at peak is ' + dataArray[newPeakIndex]);
    return peakFreq;
}


function drawReferenceScaleImage(posHz) { 
    // Aligns the reference scale image a fifth below the desired position
    // (The reference scale image is sized to start at a fifth below and extend for a width of two octaves)
    canvasStaffCtx.fillStyle = 'rgb(0, 0, 0)';
    canvasStaffCtx.fillRect(0, 0, WIDTH, HEIGHT);
    if (shapes4) {
        //document.getElementById("shapes-btn").innerHTML = "Click to change to 7 shapes";
        if (majorMode) {
            canvasStaffCtx.drawImage(major4, hzToXpos(posHz/(minDisplayedBin * hzPerBin)*.625), 0, 2.263034*canStaff.width/numDisplayedOctaves, canStaff.height);
        }
        else {
            canvasStaffCtx.drawImage(minor4, hzToXpos(posHz/(minDisplayedBin * hzPerBin)*.6), 0, 2.321928*canStaff.width/numDisplayedOctaves, canStaff.height);
        }
    }
    else {
        //document.getElementById("shapes-btn").innerHTML = "Click to change to 4 shapes";
        if (majorMode) {
            canvasStaffCtx.drawImage(major7, hzToXpos(posHz/(minDisplayedBin * hzPerBin)*.625), 0, 2.263034*canStaff.width/numDisplayedOctaves, canStaff.height);
        }
        else {
            canvasStaffCtx.drawImage(minor7, hzToXpos(posHz/(minDisplayedBin * hzPerBin)*.6), 0, 2.321928*canStaff.width/numDisplayedOctaves, canStaff.height);
        }
    }
    drawTargetPitchLines(canvasStaffCtx, canStaff.height);
}

function drawTargetPitchLines(canvasContext, canvasHeight) {
    // draw lines for equal tempered scale notes

    var notes = [
        [                                         // major notes
            {ratio:1, color:'orange', width:1},
            {ratio:1.25, color:'blue', width:1},  // just major third is 1.25; equal = 1.25992
            {ratio:1.5, color:'red', width:1},    // just perfect fifth; equal = 1.49831
            {ratio:1.88, color:'blueviolet', width:1} // mi  (2 / 16/15?); equal = 1.88775
        ],
        [
            {ratio:1, color:'orange', width:1},   // minor notes
            {ratio:1.2, color:'blue', width:1},   // just minor third is 1.2; equal = 1.18921
            {ratio:1.5, color:'red', width:1}     // perfect fifth
        ]];



    for (var i = 0; i < numDisplayedOctaves+1; i++) {
        var tonicHz = (lowestOctaveTonicHz * Math.pow(2,i))/(minDisplayedBin * hzPerBin);
        for (var j = 0; j < notes[majorMode?0:1].length; j++) {
            var noteHz = tonicHz * notes[majorMode?0:1][j].ratio;
            canvasContext.strokeStyle = notes[majorMode?0:1][j].color;
            canvasContext.lineWidth = notes[majorMode?0:1][j].width;
            canvasContext.beginPath();
            var pos = hzToXpos(noteHz);
            canvasContext.moveTo(pos, 0);
            canvasContext.lineTo(pos, canvasHeight);
            canvasContext.stroke();
        }
    }
}

function playToneFromCanvas(e) {
    var canvas = e.target;
    console.log('clientX: '+ e.clientX);
    console.log('clientY: '+ e.clientY);
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    console.log('X: '+ x);
    console.log('Y: '+ y);
    // Calibrate because the client size doesn't match the canvas.width
    var xpos = x/rect.width*WIDTH;
    console.log('xpos: '+ xpos);
    oscillator.frequency.value = xposToHz(xpos);
    //var volFactor = (rect.height - y)/rect.height * volSlider.value/100;
    var volFactor = volSlider.value/100;
    gainNode.gain.value = volFactor;
}

function releaseTone(e) {
    gainNode.gain.value = 0;
}

