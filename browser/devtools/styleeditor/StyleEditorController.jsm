/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource://gre/modules/devtools/dbg-server.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");


let StyleEditorController = function(panel) {
  EventEmitter.decorate(this);

  this._panel = panel;
  this._target = panel.target;
}

StyleEditorController.prototype = {
  connect: function() {
    if (this._target.client) {
      this.client = this._target.client;
    }
    else {
      if (!DebuggerServer.initialized) {
        DebuggerServer.init();
        DebuggerServer.addBrowserActors();
      }

      let transport = DebuggerServer.connectPipe();
      this.client = new DebuggerClient(transport);
    }
  },

  getStyleSheets: function() {

  },
}
