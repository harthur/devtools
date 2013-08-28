/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { Cu } = require("chrome");
module.exports = [];

Cu.import("resource://gre/modules/devtools/gcli.jsm");

// Fetch MagnifierManager using the current loader, but don't save a
// reference to it, because it might change with a tool reload.
// We can clean this up once the command line is loadered.
Object.defineProperty(this, "MagnifierManager", {
  get: function() {
    return require("devtools/magnifier/magnifier").MagnifierManager;
  },
  enumerable: true
});

/**
 * 'magnifier' command
 */
gcli.addCommand({
  name: "magnifier",
  description: "Magnify areas of page to inspect pixels and colors",
  buttonId: "command-button-magnifier",
  buttonClass: "command-button",
  tooltipText: "Pixel Inspector",

  exec: function(args, context) {
    let target = context.environment.target;
    let chromeDocument = context.environment.chromeDocument;

    let magnifier = MagnifierManager.instanceForTarget(target, chromeDocument);
    magnifier.toggle();
  }
});
