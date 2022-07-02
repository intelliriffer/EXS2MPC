/*
*******************************************************************
Logic/Mainstage EXS24 To Akai MPC Batch Converter v1.0
*******************************************************************

Features:
1. Will Automatically Create Keygroup Instrument or Drum Kit based on if all Samples/Zones are ONESHOT or not.
2: For DrumKits, Exact Midi Note/Pad Mapping is Created, So Pads will Reponse to and Generate Same Midi Note as Source.
This is useful if you are want to use midi clips for the captured instrument or perhaps use the original 
drum machine/plugin for Final Render
2: Supoports upto 4 velocity Layers (EXS with more layers will be Skipped for now).
3: Supports upto 128 Zones

USAGE: 
1. From Terminal Browse the Project Directory 
2. Run the command: node src/EXS2MPC.js

OR
1. Double Click the convert_mac.sh (Mac) or convert_win.bat (windows) Script.
2: Mac Users, if convet_mac.sh is not running, use terminal 
and use command chmod +x convert_mac.sh
if its still not running try the comamnd : sudo xattre -cr convert_mac.sh



Requirements:
1: Latest NodeJs installed. Download and install Current from : https://nodejs.org/en/
2: Sox : installation depends on OS (mac users can use homebrew:  brew install sox)

Instructions:
1: Copy your Exs to EXS_TO_CONVERT Folder (You can use subdirectories to organize)
2: Unless you are using Mac and Logic/Minstage Autosampled EXS,
   Copy the Samples for each EXS to Same Location as the EXS File and Run the Script.



*/


/************** SETTINGS **************/

/* ToConvert is the name of the folder in this projects directory that will be scanned for exs to convert!.
You can have subfolders inside organized as you want and it will go to each and convert exs there.
If you are not converting your own AutoSamples Exs (with samples in corect locations),
You need to copy all the samples required by that exs to same location as the exs file.
*/
const ToConvert = "EXS_TO_CONVERT";

/**
 *  Akai seems to Use Root Note + 1 value for Root Note that was sampled with the sample.
 *  This setting enables the fix by adding 1 semitone to the Original  Samples RootNoe.
*/
const RootNoteHack = true; //true or false


/**
 *  * IF SOX is installed ALWAYS USE IT (Wil Always comvert samples with correect header)
 *  Process Takes Time,
 *  Set to False to Skip use of SOX (If you are sure your samples are fine__
 */
const useSOX = true; //true or false

/**************** DECLARATIONS ********************* */

const { ChildProcess } = require('child_process');
let fs = require('fs');
let path = require('path');
let ANSI = require("./ansi");
//let ES = require('child-process').execSync();
let bigE = false;
let valid = false;
let isExpanded = false;
const DWORD = 4;
const INT16 = 2;
const BYTE = 1;

const MPC_TEMPLATES = {
    MASTER: fs.readFileSync(path.join(__dirname, "keyMasterTemplate.xml")).toString(),
    INSTRUMENT: fs.readFileSync(path.join(__dirname, "keyInstrumentTemplate.xml")).toString(),
    LAYER: fs.readFileSync(path.join(__dirname, "keyLayerTemplate.xml")).toString(),
    DEFAULTS: JSON.parse(fs.readFileSync(path.join(__dirname, "metadefaults.json")).toString()),

}


/********************* MAIN (Program Entry Point))  ******************************** */

let sDir = path.resolve(path.join(__dirname, '../', ToConvert));
if (!fs.existsSync(sDir)) ANSI.ERROR(`ERROR MISSING FOLDER TO CONVERT >> ${sDir}`);
let EXS = scanDir(sDir);
let wavConvert = hasSox();

if (!wavConvert) {
    ANSI.CYAN(`*************************************************
SOX is NOT Installed.
Sox is required to convert aif to wav files, 
Without Some Aif and Wav files might not load up!       
**************************************************`);
}

EXS.forEach(exs => process(exs));
ANSI.GREEN(`\n*************** ALL OPERATIONS COMPLETED ****************\n`);

/**************** Functions ***********************************/


function process(f) {
    /**********************************************************************
     * EXS Parsing Based on
     * https://github.com/matt-allan/renoise-exs24/blob/master/exs24.lua
     **********************************************************************/

    ANSI.YELLOW(`<<<Processing>>> ${f}`);
    let fExs = fs.openSync(f, 'r');
    let eType = Buffer.alloc(4);
    let fSize = fs.statSync(f).size;

    fs.readSync(fExs, eType, 0, DWORD, 16);
    if (!['TBOS', 'JBOS'].includes(eType.toString())) {
        cleanup(fExs);
        ANSI.ERROR(`Error: Unsupported EXS24 File: ${f}`);
        return false;
    }

    let hSize = readByteSum(fExs, DWORD, 4);

    isExpanded = hSize > 0x8000;
    let exo = {
        zones: [],
        samples: []
    }
    let si = 0; //seek index
    while (si + 84 < fSize) {

        let sig = readBytes(fExs, 4, si);
        let size = readByteSum(fExs, DWORD, si + 4);
        let typ = readBytes(fExs, DWORD, si + 16);
        if (isExpanded && size > 0x8000) size = size - 0x8000;
        let chunk_type = (byteValue(sig) & 0x0F000000) >> 24;
        if (chunk_type == 0x01) {
            if (size < 104) {
                cleanup(fExs);
                ANSI.ERROR("Error Invalid Chunk!");
                return false;
            }
            exo.zones.push(createZone(fExs, si, size + 84));
        }

        if (chunk_type == 0x03) {
            if (![392, 592, 600].includes(size)) {
                cleanup(fExs);
                console.log(size);
                ANSI.ERROR("Error Invalid 0x03 Chunk!");
                return false;
            }
            exo.samples.push(createSample(fExs, si, size + 84));

        }

        si += (size + 84);
    }

    cleanup(fExs); //close exs file

    if (!validateSamples(exo, f)) {
        ANSI.ERROR(`Conversion skipped for ${path.basename(f)} due to missing samples!`);
        cleanup(fExs);
        return false;
    }

    exo = compute(exo);
    if (exo.uniqueZones.length > 128) {
        ANSI.ERROR(`Conversion skipped for ${path.basename(f)} Resulting in More than 128 Keygroups!`);
        cleanup(fExs);
        return false;
    }

    renderMPC(exo, f);
}

/**
 * Closed the Opened File.
 * @param {File Descriptor} fid 
 */

function cleanup(fid) {
    try {
        fs.closeSync(fid);
    } catch (e) { }
}

/**
 * Converts a ByteArray into Unsigned Integer (little endian)
 * @param {Buffer} bytes 
 * @returns Unsigned Integer as Sum (Little Endian)
 */

function byteValue(bytes) {
    let sum = 0;
    for (let i = 0; i != bytes.length; i++) {
        sum = sum + (bytes[i] << (i * 8));
    }
    return sum;
}

/**
 * Reads Byte Stream and returs as buffer. 
 * @param {File Descriptor} fid 
 * @param {Number of Bytes to Read} size 
 * @param {Postion to Start Read From in the File } pos 
 * @returns  Buffer
 */
function readBytes(fid, num, pos) {
    let b = Buffer.alloc(num, 0);
    fs.readSync(fid, b, 0, num, pos);
    return b;

}
/**
 * Reads Byte Stream and returs Sum in Little Endian
 * @param {File Descriptor} fid 
 * @param {Number of Bytes to Read} size 
 * @param {Postion to Start Read From in the File } pos 
 * @returns  unsigned integer
 */
function readByteSum(fid, num, pos) {
    return byteValue(readBytes(fid, num, pos));
}

/**
 *  Create an EXS Sample Entry
 */
function createSample(fid, ix, size) {
    let S = {};
    S.id = readByteSum(fid, DWORD, ix + 8);
    S.name = readStr(fid, 64, ix + 20);
    S.length = readByteSum(fid, DWORD, ix + 88);
    S.sampleRate = readByteSum(fid, DWORD, ix + 92);
    S.bitDepth = readByteSum(fid, BYTE, ix + 96);
    S.type = readByteSum(fid, DWORD, ix + 112);
    S.path = readStr(fid, 256, ix + 164);
    S.fileName = readStr(fid, size > 420 ? 256 : 64, size > 420 ? ix + 420 : ix + 20);
    return (S);

}
/**
 * Create a Zone Entry 
 */

function createZone(fid, ix, size) {
    let Z = {};
    Z.id = readByteSum(fid, DWORD, ix + 8);
    Z.name = readStr(fid, 64, ix + 20);
    let zopts = readByteSum(fid, BYTE, ix + 84);
    Z.pitch = (zopts & (1 << 1)) == 0;
    Z.oneShot = (zopts & (1 << 0)) != 0;
    Z.reverse = (zopts & (1 << 2)) != 0;
    Z.key = readByteSum(fid, BYTE, ix + 85);
    Z.fineTune = twosCompliment(readByteSum(fid, BYTE, ix + 86), 8);
    Z.pan = twosCompliment(readByteSum(fid, BYTE, ix + 87), 8);
    Z.volume = twosCompliment(readByteSum(fid, BYTE, ix + 88), 8);
    Z.coarseTune = twosCompliment(readByteSum(fid, BYTE, ix + 164), 8);
    Z.keyLow = readByteSum(fid, BYTE, ix + 90);
    Z.keyHigh = readByteSum(fid, BYTE, ix + 91);
    Z.velRangeOn = (zopts & (1 << 3)) != 0;
    Z.velLow = readByteSum(fid, BYTE, ix + 93);
    Z.velHign = readByteSum(fid, BYTE, ix + 94);
    Z.sampleStart = readByteSum(fid, DWORD, ix + 96);
    Z.sampleEnd = readByteSum(fid, DWORD, ix + 100);
    Z.loopStart = readByteSum(fid, DWORD, ix + 104);
    Z.loopEnd = readByteSum(fid, DWORD, ix + 108);
    Z.loopCrossFade = readByteSum(fid, DWORD, ix + 112);
    lOpts = readByteSum(fid, BYTE, ix + 117);
    Z.loopOn = (lOpts & (1 << 0)) != 0;
    Z.loopEqualPower = (lOpts & (1 << 1)) != 0
    if ((zopts & (1 << 6)) == 0) {
        Z.output = -1;
    } else {
        Z.output = readByteSum(fid, BYTE, ix + 166);
    }
    Z.groupIndex = readByteSum(fid, DWORD, ix + 172);
    Z.sampleIndex = readByteSum(fid, DWORD, ix + 176);
    Z.sampleFade = 0;
    if (size > 188) {
        Z.sampleFade = readByteSum(fid, DWORD, ix + 188);
    }
    Z.offset = 0;
    if (size > 192) {
        Z.offset = readByteSum(fid, DWORD, ix + 192);
    }
    Z.UID = [Z.keyLow, Z.key, Z.keyHigh, Z.groupIndex].join('_');

    return Z;
}


function twosCompliment(value, bits) {
    if ((value & (1 << (bits - 1))) != 0) {
        return value - (1 << bits);
    }
    return value;
}

/**
 * Reads Byte Stream and returs a String. 
 * @param {File Descriptor} fid 
 * @param {Number of Bytes to Read} size 
 * @param {Postion to Start Read From in the File } pos 
 * @returns  String
 */
function readStr(fid, size, pos) {

    let bstr = readBytes(fid, size, pos);
    return bstr.slice(0, bstr.indexOf(0)).toString();

}
/**
 * Makes Sure All Samples Exist and Are Valid.
 * Copies Samples to Exs Location
 * Converts Samples to WAV using SOX 
 * (There is no bitDepth or resampling being done., Only headers are Rewritten,
 * to make sure Akai devices find the sample files valid)
 *  **/
function validateSamples(j, f) {
    let dir = path.dirname(f);
    let noerror = true;
    let formaterror = false;
    for (let i = 0; i != j.samples.length; i++) {
        let tFile = path.join(dir, j.samples[i].fileName);
        let tFile2 = tFile.split(".").slice(0, -1).join(".") + ".wav";
        let tFile3 = tFile.split(".").slice(0, -1).join(".") + ".WAV";
        if (fs.existsSync(tFile2)) tFile = tFile2;
        if (fs.existsSync(tFile3)) tFile = tFile3;
        if (!["wav", "aif"].includes(j.samples[i].fileName.split(".").slice(-1)[0].toLowerCase())) {
            ANSI.BLUE(`...Error: Unsupported Sample Format"${j.samples[i].fileName}"`);
            formatError = true;
        }

        if (!formaterror && !fs.existsSync(tFile)) {
            let src = path.join(j.samples[i].path, j.samples[i].fileName);

            if (!fs.existsSync(src)) {
                ANSI.BLUE(`...Error: Sample(s) Missing, Please Copy "${j.samples[i].fileName}" to "${dir}"`);
                noerror = false;
            } else {
                fs.copyFileSync(src, tFile);
            }
        }
        if (noerror && wavConvert && useSOX) {
            let oExt = tFile.split(".").slice(-1)[0];
            let fExt = ".WAV";
            if (oExt.toLowerCase() == "wav") {
                fExt = "." + oExt
            }
            let tmp = path.join(path.dirname(tFile), 'tmp.WAV');
            let wFile = tFile.split(".").slice(0, -1).join(".") + fExt;
            try {
                let sxCmd = `sox "${tFile}" -t wavpcm "${tmp}"`;

                let sox = require('child_process').execSync(sxCmd, { stdio: [] }).toString();
                fs.copyFileSync(tmp, wFile);
                fs.unlinkSync(tmp);
                if (oExt.toLowerCase() == "aif") {
                    fs.unlinkSync(tFile);
                }

            } catch (e) {
                ANSI.ERROR('SOX Conversion Failed for Sample!')
                console.log(e);
            }
        }
    }
    return noerror && !formaterror;
}


/**
 * 
 * Generates the MPC Keygroup 
 * If all Zones in Keygroup are OneShot, The Generated File with be Type: Drum Kit
 */
function renderMPC(xs, f) {
    let isDrum = true;
    let DMAP = [];
    let fo = f.split(".").slice(0, -1).join(".") + ".xpm";
    let master = MPC_TEMPLATES.MASTER;
    master = TR(master, 'NAME', path.basename(f, ".exs"));
    master = TR(master, 'GROUPS', xs.uniqueZones.length);
    let INS = [];
    xs.uniqueZones.sort((a, b) => a - b);

    let error = false;
    xs.uniqueZones.forEach((uz, index) => {
        let zones = xs.zones.filter(z => z.UID == uz);
        let z = zones[0];
        if (zones.length > 4) {
            doRanges(zones);
            error = 1;
            return;
        };

        let I = MPC_TEMPLATES.INSTRUMENT;
        DMAP.push(z.key);
        I = TR(I, 'ID', index + 1);
        I = TR(I, 'COARSE', z.coarseTune);
        I = TR(I, 'FINE', z.fineTune);
        I = TR(I, 'LOW', z.keyLow);
        I = TR(I, 'HIGH', z.keyHigh);
        I = TR(I, 'ONESHOT', z.oneShot ? 'True' : 'False');
        if (!z.oneShot) isDrum = false;
        let IL = [];
        zones.forEach((lz, lx) => {
            let L = MPC_TEMPLATES.LAYER;
            L = TR(L, 'NUM', lx + 1);
            L = TR(L, 'VOLUME', toAkaiDb(lz.volume));
            L = TR(L, 'PAN', "0.50");
            L = TR(L, 'COARSE', lz.coarseTune);
            L = TR(L, 'CENTS', lz.fineTune);
            L = TR(L, 'VELSTART', lz.velLow);
            L = TR(L, 'VELEND', lz.velHign);
            L = TR(L, 'ROOT', parseInt(lz.key) + (RootNoteHack ? 1 : 0));
            //   console.log("ROOT", parseInt(lz.key) + (RootNoteHack ? 1 : 0));
            let smpl = xs.samples[lz.sampleIndex];

            L = TR(L, 'SAMPLE', smpl.fileName.split(".").slice(0, -1).join("."));
            L = TR(L, 'LOOPEND', lz.loopEnd);
            L = TR(L, 'LOOPSTART', lz.loopStart);
            L = TR(L, 'SAMPLESTART', lz.sampleStart);
            L = TR(L, 'DOLOOP', lz.loopOn ? 1 : 0);
            Object.keys(MPC_TEMPLATES.DEFAULTS.KEYLAYERTEMPLATE).forEach(k => L = TR(L, k.NODE, k.DEFAULT));
            IL.push(L);

        });
        I = TR(I, 'LAYERS', IL.join("\n"));
        Object.keys(MPC_TEMPLATES.DEFAULTS.KEYINSTRUMENTTEMPLATE).forEach(k => I = TR(I, k.NODE, k.DEFAULT));
        INS.push(I);
    });
    if (!error) {
        if (isDrum) {
            master = master.replace(`<Program type="Keygroup">`, `<Program type="Drum">`);
            master = addDrumMap(master, DMAP);
        }

        master = TR(master, 'INSTRUMENTS', INS.join("\n"));

        Object.keys(MPC_TEMPLATES.DEFAULTS.KEYMASTERTEMPLATE).forEach(k => master = TR(master, k.NODE, k.DEFAULT));
        fs.writeFileSync(fo, master);
        ANSI.GREEN(`  >> Generated ${isDrum ? "DrumKit" : "KeyGroup"} <<${fo}>>`);
    } else {

        ANSI.ERROR(`Error! Exs ${f} Has More than 4 Layers! Not Supported!`);
    }
}




function compute(x) {
    let z = x.zones;
    let uzones = [];
    z.forEach(zn => uzones.includes(zn.UID) ? '' : uzones.push(zn.UID));
    x.uniqueZones = uzones;
    return x;
}

/**
 * Template Replace
 * Replaces node (##Token##)  in the Template with the Value.
 */
function TR(data, node, value) {
    return data.replaceAll(`##${node}##`, value);
}


function doRanges(zones) {
    // ::TODO:: convert more than 4 velocity layers to 4
    /*   console.log('***************');
   
       zones.forEach(z => {
   
           console.log(z.velLow, z.velHign, z.groupIndex, z.sampleIndex);
       });*/
}

/**
 * Convert Absolute Decibles Value to 0f-1f
 **/
function toAkaiDb(value) {
    let f = 0.35300;
    v = 12 + (value > 6 ? 6 : value);
    return f + ((1 - f) * v / 18.0);
}
/**
 * Scan the Directory Tree for Exs Samples
 *  **/

function scanDir(d) {
    let scan = fs.readdirSync(d);
    let dirs = scan.filter(x => fs.statSync(path.join(d, x)).isDirectory()).map(s => path.join(d, s));
    let exs = scan.filter(s => s.toLowerCase().endsWith('.exs')).map(s => path.join(d, s));
    dirs.forEach(d => {
        exs = exs.concat(scanDir(d));
    });
    return exs;
}
/**
 * Determine whether Sox is installed.
 * Sox can be installed om mac using homebrew
 * on Windows it can directly be downloaded and it path
 * should be added to environment PATH variable.
 **/
function hasSox() {
    try {
        let sox = require('child_process').execSync('sox --version').toString();
        return true;
    }
    catch (e) {
        return false;
    }
}
function addDrumMap(template, dMap) {
    if (!dMap.length) return template;

    let min = dMap[0];
    let max = dMap[dMap.length - 1];
    let d = '<PadNoteMap>';
    dMap.forEach((m, i) => {
        d += `\n<PadNote number="${i + 1}">
            <Note>${dMap[i]}</Note>
        </PadNote>`;
    });

    let base = dMap.length + 1;
    for (let i = max + 1; i <= 127; i++) {
        d += `\n<PadNote number="${base + i - (max + 1)}">
            <Note>${i}</Note>
        </PadNote>`;
    }

    base = base + 127 - max
    for (let i = 0; i < min; i++) {

        d += `\n<PadNote number="${i + base}">
            <Note>${i}</Note>
        </PadNote>`;

    }


    d = d + `\n</PadNoteMap>`;

    template = template.replace('</Instruments>', `</Instruments>\n${d}`);
    return template;

}