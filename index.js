#!/usr/bin/env node --trace-warnings
require('colors');
const $fs = require('fs');
const $path = require('path');
const $cp = require("child_process");

const Command = require('commander').Command;
const inquirer = require('inquirer');
const Metalsmith = require('metalsmith');
const handlebars = require('metalsmith-handlebars-contents');
const downloadRepoDir = require('dl-repo-dir').downloadRepoDir;
const log = require('debug')('x-template');
const cwd = process.cwd();

const program = new Command();
program.version('0.0.1');

program
  .option('-c, --config <config>', 'config file')
  .option('-d, --dir <dir>', 'directory to download from source')
  .option('--source-dir <srcDir>', 'source directory name for template')
  .option('--clean', 'clean source directory when complete')
  .command('init <source> [destination]')
  .description('Initialize from a template into a newly created directory')
  .action((source, destination) => {
    if ($fs.existsSync(destination)) {
      destination = cwd;
    }
    init(source, destination, program.opts());
  });

program.parse(process.argv);

function init(source, dest, opts) {
  downloadRepoDir(source, opts.dir || '', dest, function (data) {
    process.stdout.write(`\r${(data.percent * 100).toFixed(1)}% Downloaded `)
  }, (tmpDir, newPath) => {
    log(tmpDir.red, newPath.green);
    const metadata = readMetadata(tmpDir, dest) || {};
    inquirer.prompt(metadata.prompts).then(answer => {
      return renderTemplate(answer || {}, tmpDir, newPath, opts, metadata)
    }).then(answer => {
      if (metadata.complete) {
        metadata.complete({
          ...answer,
          inPlace: cwd === dest,
          destDirName: $path.dirname(dest),
          noEscape: true
        });
      } else if (metadata.completeMessage) {
        console.log(metadata.completeMessage);
      }
    });
    return false;
  }).then(function () {
    process.stdout.write(' Done!\n');
  }).catch(function (e) {
    console.log('error:', e ? (e.message || e) : e)
  });
}

function renderTemplate(data, src, dest, opts, metadata) {
  const skipped = metadata.skipInterpolation || [];
  return new Promise((resolve, reject) => {
    Metalsmith(src)
      .metadata(data)
      .source(opts.srcDir || 'template')
      .destination(dest)
      .clean(opts.clean || false)
      .use(handlebars({ match: mergeWithSkipped('**/*', skipped)}))
      .build(function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
  })
}

function mergeWithSkipped(match, skipped) {
  return [match, ...skipped.map(it => `!${it}`)];
}

function readMetadata(sourceDir, dest) {
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
    data = require($path.resolve(sourceDir, metafile));
  } catch(e) {
    console.error(`There are syntax errors in ${metafile}: `, e);
  }
  if (data.prompts && data.prompts.author) {
    data.prompts.author.default = getAuthor();
  }
  data.prompts = transformMetaPropmptsForInquirer(data.prompts);
  return data;
}

const promptMapping = {
  string: 'input',
  boolean: 'confirm'
};

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
  log(questions);
  return questions;
}

function getAuthor() {
  let name;
  let email;
  try {
    name = exec("git config --get user.name");
    email = exec("git config --get user.email");
  } catch (e) {}
  name = name && JSON.stringify(name.toString().trim()).slice(1, -1);
  email = email && " <" + email.toString().trim() + ">";
  return (name || "") + (email || "");
};

process.on('uncaughtException', err => {
	console.error('Uncaughted Exception:', err);
});

