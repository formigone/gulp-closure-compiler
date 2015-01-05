var Buffer = require('buffer').Buffer;
var child_process = require('child_process');
var fs = require('fs');
var gutil = require('gulp-util');
var path = require('path');
var tempWrite = require('temp-write');
var through = require('through');
var glob = require('glob');

const PLUGIN_NAME = 'gulp-closure-library';

module.exports = function(opt, execFile_opt) {
  opt = opt || {};
  opt.maxBuffer = opt.maxBuffer || 1000;
  var files = [];
  var execFile = execFile_opt || child_process.execFile;

  if (!opt.fileName)
    throw new gutil.PluginError(PLUGIN_NAME, 'Missing fileName option.');

  var getFlagFilePath = function(files) {
    var src = files.map(function(file) {
      var relativePath = path.relative(file.cwd, file.path);
      var tempPath = tempWrite.sync(file.contents.toString(), relativePath);
      return '--js=' + tempPath;
    }).join('\n');
    return tempWrite.sync(src);
  };

  // Can't use sindresorhus/dargs, compiler requires own syntax.
  var flagsToArgs = function(flags) {
    var args = [];
    for (var flag in flags || {}) {
      var values = flags[flag];
      if (!Array.isArray(values)) values = [values];
      values.forEach(function(value) {
        if (flag === 'externs') {
          glob.sync(value).forEach(function(resolved){
            args.push(buildFlag(flag, resolved))
          });
        }else{
          args.push(buildFlag(flag, value));
        }
      });
    }
    return args;
  };

  var buildFlag = function(flag, value){
    return '--' + flag + (value === null ? '' : '=' + value)
  };

  function bufferContents(file) {
    if (file.isNull()) return;
    if (file.isStream()) {
      return this.emit('error',
        new gutil.PluginError(PLUGIN_NAME, 'Streaming not supported'));
    }
    files.push(file);
  }

  function endStream() {
    if (!files.length) return this.emit('end');
    var firstFile = files[0];
    var outputFilePath = tempWrite.sync('');
    var args;
    if (opt.compilerPath) {
      args = [
        '-jar',
        // For faster compilation. It's supported everywhere from Java 1.7+.
        '-XX:+TieredCompilation',
        opt.compilerPath,
        // To prevent maximum length of command line string exceeded error.
        '--flagfile=' + getFlagFilePath(files)
      ];
    } else {
      args = [
        // To prevent maximum length of command line string exceeded error.
        '--flagfile=' + getFlagFilePath(files)
      ];
    }
    args = args.concat(flagsToArgs(opt.compilerFlags));

    var javaFlags = opt.javaFlags || [];
    args = javaFlags.concat(args);

    // Force --js_output_file to prevent [Error: stdout maxBuffer exceeded.]
    args.push('--js_output_file=' + outputFilePath);

    // Enable custom max buffer to fix "stderr maxBuffer exceeded" error. Default is 1000*1024.
    var executable = opt.compilerPath ? 'java' : 'closure-compiler';
    var jar = execFile(executable, args, { maxBuffer: opt.maxBuffer*1024 }, function(error, stdout, stderr) {
      if (error || stderr) {
        this.emit('error', new gutil.PluginError(PLUGIN_NAME, error || stderr));
        process.exit(1);
        return;
      }

      var outputFileSrc = fs.readFile(outputFilePath, function(err, data) {
        if (err) {
          this.emit('error', new gutil.PluginError(PLUGIN_NAME, err));
          process.exit(1);
          return;
        }

        var outputFile = new gutil.File({
          base: firstFile.base,
          contents: new Buffer(data),
          cwd: firstFile.cwd,
          path: path.join(firstFile.base, opt.fileName)
        });

        this.emit('data', outputFile);
        this.emit('end');
      }.bind(this));

    }.bind(this));
  }

  return through(bufferContents, endStream);
};
