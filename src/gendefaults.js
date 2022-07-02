let fs = require('fs');
let path = require('path');
let files = fs.readdirSync(__dirname).filter(f => f.toLowerCase().endsWith(".xml"));
let odata = {};
files.forEach(generateMap);
fs.writeFileSync("metadefaults.json", JSON.stringify(odata, null, 2));
function generateMap(f) {
    let xml = fs.readFileSync(path.join(__dirname, f)).toString();
    let m = xml.match(/##[^#]+##/gis);
    let tFile = path.basename(f, ".xml");
    let o = m.map(h => {
        return {
            NODE: h.replaceAll("#", ''),
            DEFAULT: "0"
        }
    });
    odata[tFile.toUpperCase()] = o;
}