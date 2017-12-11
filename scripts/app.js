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

// Anti-aliasing filter before decimating
// This is crazy that the coefficients aren't exposed
// I wanted a 4th order elliptical filter for sharp cutoff.
// Can I even make that with what they expose?
// For now, use 2 cascaded Butterworths (Linkwitz-Riley)
// Down 6 dB at fc, which is set to 1500 Hz
// We mean to sample at 48/8 = 6 kHz

var fftSize = 2048;  // power of 2
var downSampleRatio = 8;
var numSegments = 4;

var biquad1 = audioCtx.createBiquadFilter();
var biquad2 = audioCtx.createBiquadFilter();
biquad1.type = "lowpass";
biquad1.frequency.value = 1500;
biquad1.Q = 0.7071
biquad2.type = "lowpass";
biquad2.frequency.value = 1500;
biquad2.Q = 0.7071

// Create a script node to dump the data to a buffer for decimating
// We need 1/3 of a second worth of data (16384/48000) to get 3 Hz resolution for bass bins
// But that update rate makes the screen look jerky
// Try doing it numsegments times as often - making the scriptProcessor buffer 1/numSegments
// of the sizeand reusing the saved samples again on the next FFT
var scriptNode = audioCtx.createScriptProcessor(downSampleRatio*fftSize/numSegments, 1, 1);
var savedSamples = new Array(numSegments);
for (var i = 0; i < numSegments; i++)
{
    savedSamples[i] = new Array(fftSize/numSegments).fill(0);
}
var savedSamplesIndex = 0;

biquad1.connect(biquad2);
biquad2.connect(scriptNode);

// Performance counters
var lastAudioProcessTime = Date.now();
var lastAnimationFrameTime = Date.now();
var audioProcessCounter = 0;
var animationFrameCounter = 0;

// Create the buffer

var real = new Array(fftSize);
var imaginary = new Array(fftSize);

var magnitude = new Array(fftSize/2).fill(0);
var magdB = new Array(fftSize/2).fill(0);
var freqDataArray = new Uint8Array(fftSize/2);
var smoothingTimeConstant = 0.65;
var analyser = audioCtx.createAnalyser();
var minDecibels = -80;
var maxDecibels = -10;
var byteScaleFactor = 255/(maxDecibels - minDecibels);


var fftWindow = new Array(fftSize);
for (var i = 0; i < fftSize; i++)
{
    // Blackman window
    // I don't see that the fft.js function scales by 1/N, so include 1/N factor while windowing
    fftWindow[i] = (0.42 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize-1)) + 0.08 * Math.cos(4 * Math.PI * i / (fftSize-1)))/fftSize;
}

scriptNode.onaudioprocess = function(audioProcessingEvent) {
    /*
    audioProcessCounter++;
    if (audioProcessCounter > 20)
    {
        var time = Date.now();
        console.log('Average audio process interval '+ (time - lastAudioProcessTime)/20 + ' ms');
        lastAudioProcessTime = time;
        audioProcessCounter = 0;
    }
    */


    var inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
    //console.log("On audio process");

    // This is a lot of copying.  Optimize?
    for (var i = 0; i < inputData.length/downSampleRatio; i++)
    {
        for (var j = 0; j < numSegments - 1; j++)
        {
            real[j*fftSize/numSegments + i] = savedSamples[(savedSamplesIndex + j + 1)%numSegments][i] * fftWindow[j*fftSize/numSegments + i];
        }
        real[(numSegments - 1)*fftSize/numSegments + i] = inputData[i*downSampleRatio] * fftWindow[(numSegments - 1)*fftSize/numSegments + i];
        savedSamples[savedSamplesIndex][i] = inputData[i*downSampleRatio];
    }
    savedSamplesIndex = (savedSamplesIndex + 1)%numSegments;
    imaginary.fill(0);

    transform(real, imaginary);

    // find magnitudes and smooth as in the web audio spec
    // we only care about the first N/2 - 1 points
    for (var i = 0; i < fftSize/2; i++)
    {
        magnitude[i] = magnitude[i] * smoothingTimeConstant 
            + Math.sqrt((real[i]*real[i] + imaginary[i]*imaginary[i])) * (1 - smoothingTimeConstant);
        var magdB = 20 * Math.log10(magnitude[i]);
        if (magdB < minDecibels)
            freqDataArray[i] = 0;
        else if (magdB > maxDecibels)
            freqDataArray[i] = 255;
        else
            freqDataArray[i] = (magdB - minDecibels) * byteScaleFactor;
    }
}


var dummyAnalyser = audioCtx.createAnalyser();
dummyAnalyser.fftSize = 32; // minimum allowed
scriptNode.connect(dummyAnalyser);  // onAudioProcess event doesn't fire in Chrome if scriptNode isn't connected to something
// By experiment, a dummy gain node didn't satisfy it
// https://github.com/WebAudio/web-audio-api/issues/345
// https://bugs.chromium.org/p/chromium/issues/detail?id=327649


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
    source.connect(biquad1);

    showAudio();
})
.catch(function(err) {
    console.log('The following gUM error occured: ' + err);
})


WIDTH = canvas.width;
HEIGHT = canvas.height;

// Independent parameters

// High extreme, at a minimum, for non-coloratura sopranos is C6 = 1046.5 Hz
// TYpical opera bass has a range down to E2 = 82.4069 Hz
var minHz = 80; // must be greater than 0
var maxHz = 1280;  // must be less than audioCtx.sampleRate/downSampleRatio/2;
var refTonicHz = 261.63;      // controls lines
var colorBreakHz = 130.813;  // boundary of octaves (shown with rainbow colored bars)


// Calculated parameters
var hzPerBin = audioCtx.sampleRate / downSampleRatio / fftSize;

var minDisplayedBin;
var maxDisplayedBin;
var numDisplayedOctaves;
sizeCanvas();
var lowestOctaveTonicHz = calculateLowestOctaveTonicHz(refTonicHz);

// State variables
var majorMode = true;
var shapes4 = false;
var tonePlaying = false;




canvasStaffCtx.fillStyle = 'rgb(0, 0, 0)';
canvasStaffCtx.fillRect(0, 0, WIDTH, HEIGHT);

var canvasStaffHeight = 200;
canvasCtx.fillStyle = 'rgb(0, 0, 0)';
canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);
drawReferenceScaleImage(refTonicHz);


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
        /*
        animationFrameCounter++;
        if (animationFrameCounter > 500)
        {
            var time = Date.now();
            console.log('Average animation frame interval '+ (time - lastAnimationFrameTime)/500 + ' ms');
            lastAnimationFrameTime = time;
            animationFrameCounter = 0;
        }
        */


        canvasCtx.fillStyle = 'rgb(0, 0, 0)';
        canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

        var barHeight;
        var cumWidth = 0;

        for(var i = 0; i < maxDisplayedBin - minDisplayedBin; i++) {
            binHz = binToHz(minDisplayedBin) + i * hzPerBin;
            /* TODO: refine scaling - was chosen by experiment*/
            barHeight = freqDataArray[i + minDisplayedBin] * HEIGHT /256;

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
    var peakHz = getPeakFreq(freqDataArray);
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

    // Hacky fixup for button text line-breaking at different widths
    // Force target button and shapes button to break when the mode button does
    // Works on Chrome down to about 300px width
    targetButton.innerHTML = "Set Targets";
    if (targetButton.clientHeight < modeButton.clientHeight)
        targetButton.innerHTML = "Set<br>Targets";

    shapesButton.innerHTML = "4 or 7 Shapes";
    if (shapesButton.clientHeight < modeButton.clientHeight)
        shapesButton.innerHTML = "4 or 7<br>Shapes";
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
            {ratio:1.5, color:'red', width:1}    // just perfect fifth; equal = 1.49831
            //{ratio:1.88, color:'blueviolet', width:1} // mi  (2 / 16/15?); equal = 1.88775
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

