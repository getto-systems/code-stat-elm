"use strict";

const fs = require("fs");
const path = require("path");

exports.dump = (opts) => {
  if (!fs.statSync(opts.dir).isDirectory()) {
    console.error(opts.dir + " is not directory");
  } else {
    const modules = {
      projects: getModules(opts.dir, opts.encode),
      packages: getPackageModules(opts.packageDir, parseElmJson(opts.elm), opts.encode),
    };

    let data = {};

    const merge = (key, dict) => {
      Object.keys(dict).forEach((module) => {
        if (!data[module]) {
          data[module] = {};
        }
        data[module][key] = dict[module];
      });
    };

    merge("ossification", dump({}, modules, ossification(modules)));
    merge("instability", dump({}, modules, instability(modules)));
    merge("fluidity", dump({}, modules, fluidity(opts.fluidity)));

    const toCount = (info,key) => {
      if (!info[key]) {
        info[key] = null;
      } else {
        info[key] = Object.keys(info[key]).length;
      }
    };

    Object.keys(data).forEach((module) => {
      toCount(data[module],"ossification");
      toCount(data[module],"instability");
    });

    return {
      counts: data,
      modules: modules,
    };
  }
};

const parseElmJson = (elm) => {
  return JSON.parse(fs.readFileSync(elm, { encoding: "utf-8" }));
};

// dir/{elm-version}/package/{user}/{repo}/{version}/src/...
const getPackageModules = (dir,elm,encode) => {
  const root = path.join(dir, elm["elm-version"], "package");
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    console.error(dir + " is not directory");
    return {};
  }

  let modules = {};

  const merge = (data) => {
    Object.keys(data).forEach((key) => {
      modules[key] = data[key];
    });
  };

  const detect = (user,repo) => {
    const packageName = user + "/" + repo;
    if (elm.dependencies.direct[packageName]) {
      return elm.dependencies.direct[packageName];
    } else {
      if (elm.dependencies.indirect[packageName]) {
        return elm.dependencies.indirect[packageName];
      } else {
        return null;
      }
    }
  };

  fs.readdirSync(root, { withFileTypes: true }).forEach((user) => {
    if (user.isDirectory()) {
      fs.readdirSync(path.join(root, user.name), { withFileTypes: true }).forEach((repo) => {
        if (repo.isDirectory()) {
          const version = detect(user.name,repo.name);
          if (version !== null) {
            merge(getModules(path.join(root, user.name, repo.name, version, "src"), encode));
          }
        }
      });
    }
  });

  return modules;
};

// { Module.Name => { name : Module.Name, file : path, imports: { Module.Name => true } } }
const getModules = (dir,encode) => {
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    if (stat.isSymbolicLink()) {
      return getModules(path.join(dir, fs.readlinkSync(dir)),encode);
    }
    if (stat.isFile()) {
      return getModuleInfo(dir,encode);
    } else {
      console.error(dir + " is not directory");
      return {};
    }
  }

  let modules = {};

  const merge = (data) => {
    Object.keys(data).forEach((key) => {
      modules[key] = data[key];
    });
  };

  fs.readdirSync(dir, { withFileTypes: true }).forEach((file) => {
    if (file.isDirectory()) {
      merge(getModules(path.join(dir, file.name),encode));
    } else {
      if (file.isSymbolicLink()) {
        merge(getModules(path.join(dir, fs.readlinkSync(path.join(dir, file.name))),encode));
      } else {
        if (file.isFile()) {
          merge(getModuleInfo(path.join(dir, file.name),encode));
        }
      }
    }
  });

  return modules;
};

const getModuleInfo = (file,encode) => {
  if (!file.endsWith(".elm")) {
    return {};
  }

  const body = fs.readFileSync(file, { encoding: "utf-8" });
  const module = getModuleName(body);

  if (module === null) {
    console.error("FAILED: detect module name " + file);
    return {};
  }

  let info = {};
  info[module] = {
    name: module,
    file: file,
    imports: getModuleImports(body.split("\n")),
  };
  return info;
};

const getModuleName = (body) => {
  const first = body.split("\n")[0];
  const regexp = /module (([A-Z][A-Za-z0-9]+)([.][A-Z][A-Za-z0-9]+)*)/;
  const match = regexp.exec(first);
  if (match === null) {
    return null;
  } else {
    return match[1];
  }
};

const getModuleImports = (body) => {
  const regexp = /^import (([A-Z][A-Za-z0-9]+)([.][A-Z][A-Za-z0-9]+)*)/g;
  let match;
  let result = {};

  body.forEach((line) => {
    do {
      match = regexp.exec(line);
      if (match !== null && match[1]) {
        result[match[1]] = true;
      }
    } while (match !== null);
  });

  return result;
};

const dump = (data, modules, analyze) => {
  [ modules.projects, modules.packages ].forEach((info) => {
    Object.keys(info).forEach((module) => {
      data = analyze(data, module, info[module]);
    });
  });
  return data;
};

const ossification = (modules) => {
  const find = (data, module, entry) => {
    if (data[module]) {
      return data;
    }

    data[module] = {};

    [ modules.projects, modules.packages ].forEach((dict) => {
      Object.values(dict).forEach((info) => {
        if (info.imports[module]) {
          data[module][info.name] = true;

          data = find(data, info.name, info);
          Object.keys(data[info.name]).forEach((name) => {
            data[module][name] = true;
          });
        }
      });
    });

    return data;
  };

  return find;
};

const instability = (modules) => {
  const find = (data, module, entry) => {
    if (data[module]) {
      return data;
    }

    data[module] = {};

    Object.keys(entry.imports).forEach((target) => {
      data[module][target] = true;

      if (modules.projects[target]) {
        data = find(data, target, modules.projects[target]);
        Object.keys(data[target]).forEach((name) => {
          data[module][name] = true;
        });
      } else {
        if (modules.packages[target]) {
          data = find(data, target, modules.packages[target]);
          Object.keys(data[target]).forEach((name) => {
            data[module][name] = true;
          });
        } else {
          if (!target.startsWith("Elm.")) {
            console.error("package not found: " + target);
          }
        }
      }
    });

    return data;
  };

  return find;
};

const fluidity = (getFluidity) => {
  return (data, module, entry) => {
    if (data[module]) {
      return data;
    }

    data[module] = getFluidity(module, entry);

    return data;
  };
};
