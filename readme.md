# EXS2MPC - EXS24 to Akai MPC Keygroup/DrumKit Converter #

### [Download Zip](https://github.com/intelliriffer/EXS2MPC/archive/refs/heads/main.zip) ###

## Features:
1. Will Automatically Create Keygroup Instrument or Drum Kit based on if all Samples/Zones are ONESHOT or not.
2. For DrumKits, Exact Midi Note/Pad Mapping is Created, So Pads will Respond to and Generate Same Midi Note as Source.This is useful if you are want to use midi clips for the captured instrument or perhaps use the original drum machine/plugin for Final Render
3. Supports up to 4 velocity Layers (EXS with more layers will be Skipped for now).
4. Supports up to 128 Zones
5. Batch Conversion and Directory Tree Conversion (will convert multiple EXS even in SubFolders)

## USAGE 
1. From Terminal Browse to the EXS2MPC Project Directory 
2. Run the command: node src/EXS2MPC.js

OR

1. Double Click the convert_mac.sh (Mac) or convert_win.bat (windows) Script.
2: Mac Users, if convert_mac.sh is not running, use terminal 
and use command chmod +x convert_mac.sh
if its still not running try the command : sudo xattr -cr convert_mac.sh


## Requirements:
1. Latest NodeJs installed. Download and install Current from : https://nodejs.org/en/
2. Sox: installation depends on OS. 
   1. Mac Users
      1. If you have homebrew, install using command: brew install sox
      2. or you can install from [MacPorts](https://ports.macports.org/port/sox/)
   2. Windows Users
      1. Download From [http://sox.sourceforge.net/](http://sox.sourceforge.net/)
      2. Install and Add its Path (bin) to System Path (environment)

## Instructions:
1: Copy your Exs to EXS_TO_CONVERT Folder (You can use subdirectories to organize)
2: Unless you are using Mac and Own Logic/Mainstage Autosampled (vst/synths) EXS,
   Copy the Samples for each EXS to Same Location as the EXS File and Run the Script.
