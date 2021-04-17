#!/usr/bin/env node --trace-warnings
require('colors');
const $fs = require('fs');
const $path = require('path');
const $cp = require('child_process');
const Command = require('commander').Command;
const inquirer = require('inquirer');
const Metalsmith = require('metalsmith');
const handlebars = require('metalsmith-handlebars-contents');
const Handlerbars = require('handlebars');
const render = require('consolidate').handlebars.render;
const downloadRepoDir = require('dl-repo-dir').downloadRepoDir;
const log = require('debug')('x-template');
const cwd = process.cwd();
const promptMapping = {
  string: 'input',
  boolean: 'confirm'
};

const program = new Command();
program.version('0.0.1');

program
  .option('-c, --config <config>', 'config file')
  .option('-d, --dir <dir>', 'directory to download from source')
  .option('--source-dir <srcDir>', 'source directory name for template')
  .option('--clean', 'clean source directory when complete')
  .option('--clone', 'clone from git repository')
  .command('init <source> [destination]')
  .description('Initialize from a template into a newly created directory')
  .action((source, destination) => {
    if (!destination) {
      log(`dest not provided, use cwd=${cwd} as dest`);
      destination = cwd;
    }
    if (!$fs.existsSync(destination)) {
      inquirer.prompt([{
        type: 'confirm',
        name: 'create',
        message: `Do you want to create ${destination} in current directory?`,
        default: true,
      }]).then(answer => {
        if (answer.create) {
          const dest = $path.resolve(cwd, destination)
          $fs.mkdirSync(dest);
          init(source, dest, program.opts());
        } else {
          process.exit(-1);
        }
      })
    } else {
      init(source, destination, program.opts());
    }
  });

program.parse(process.argv);

function init(source, dest, opts) {
  if ($fs.existsSync(source) && $fs.lstatSync(source).isDirectory()) {
    log(`Using local template from ${source}`);
    templating(source, dest);
  } else {
    log(`Downlaod from ${source}`);
    downloadRepoDir(source, opts.dir || '', dest, function (data) {
      process.stdout.write(`\r${(data.percent * 100).toFixed(1)}% Downloaded `)
    }, templating);
  }
  
  function templating (tmpDir, newPath) {
    log(tmpDir.red, newPath.green);
    const metadata = readMetadata(tmpDir, dest) || {};
    const metalsmith = Metalsmith(tmpDir);

    if (metadata.metalsmith && metadata.metalsmith.before === 'function') {
      metadata.metalsmith.before(metalsmith, metadata, metadata.helpers);
    }
    
    inquirer.prompt(metadata.prompts).then(answer => {
      if (metadata.metalsmith && typeof metadata.metalsmith.after === 'function') {
        log(`Found metalsmith.after`);
        metadata.metalsmith.after(metalsmith, metadata, metadata.helpers)
      }
      return renderTemplate(metalsmith, answer || {}, newPath, opts, metadata)
    }).then(answer => {
      if (metadata.complete) {
        metadata.complete({
          ...answer,
          inPlace: cwd === dest,
          destDirName: $path.dirname(dest),
          noEscape: true
        }, metadata.helpers);
      } else if (metadata.completeMessage) {
        render(metadata.completeMessage, metalsmith.metadata(), (err, res) => {
          if (err) {
            console.error('\n   Error when rendering template complete message: ' + err.message.trim())
          } else {
            console.log('\n' + res.split(/\r?\n/g).map(line => '   ' + line).join('\n'))
          }
        })
      }
    }).then(function () {
      process.stdout.write(' Done!\n');
    }).catch(function (e) {
      console.log('error:', e ? (e.message || e) : e)
    });
  };
}

function renderTemplate(metalsmith, data, dest, opts, metadata) {
  log(`Rendering template to ${dest}`)
  const match = mergeWithSkipped('**/*', metadata.skipInterpolation || []);
  log(`Match: ${match}`);
  return new Promise((resolve, reject) => {
    metalsmith.metadata(data)
      .source(opts.srcDir || 'template')
      .destination(dest)
      .clean(opts.clean || false)
      .use(handlebars({
        match,
        helpers: metadata.helpers,
      })).build(function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
  });
}

function mergeWithSkipped(match, skipped) {
  return [match, ...skipped.map(it => `!${it}`)];
}

function readMetadata(sourceDir) {
  let data = {
    prompts: [],
    complete: () => {},
    completeMessage: ''
  };
  const metafile = ['meta.js', 'meta.json']
    .map(name => $path.resolve(sourceDir, name))
    .find($fs.existsSync);
  if (!metafile) return data;
  try {
    log(`load metadata from ${metafile}`);
    data = require($path.resolve(sourceDir, metafile));
  } catch(e) {
    console.error(`There are syntax errors in ${metafile}: `, e);
  }
  if (data.prompts && data.prompts.author) {
    log('get default author')
    data.prompts.author.default = getAuthor();
  } else {
    log('no author in prompts');
  }
  data.prompts = transformMetaPropmptsForInquirer(data.prompts);
  if (!data.helpers) data.helpers = {};
  Object.keys(data.helpers).forEach(key => {
    Handlerbars.registerHelper(key, data.helpers[key]);
  });
  return data;
}

function transformMetaPropmptsForInquirer(prompts) {
  const questions = [];
  for (let name in prompts) {
    const it = prompts[name];
    const type = promptMapping[it.type] || it.type;
    questions.push({
      ...it,
      name,
      type,
      message: it.message || it.label,
    });
  }
  // log(questions);
  return questions;
}

function getAuthor() {
  let name;
  let email;
  try {
    name = $cp.execSync("git config --get user.name");
    email = $cp.execSync("git config --get user.email");
  } catch (e) {
    console.log(`Command git not found`);
  }
  name = name && JSON.stringify(name.toString().trim()).slice(1, -1);
  email = email && " <" + email.toString().trim() + ">";
  return (name || "") + (email || "");
};
