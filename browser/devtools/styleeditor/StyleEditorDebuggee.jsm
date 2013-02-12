/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleEditorDebuggee"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource://gre/modules/devtools/dbg-server.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
Cu.import("resource:///modules/devtools/StyleSheet.jsm");


let StyleEditorDebuggee = function(target) {
  EventEmitter.decorate(this);

  this.clear = this.clear.bind(this);
  this.reset = this.reset.bind(this);
  this._onStyleSheetsAdded = this._onStyleSheetsAdded.bind(this);

  this._target = target;

  this._target.on("will-navigate", this.clear);
  this._target.on("navigate", this.reset);
}

StyleEditorDebuggee.prototype = {
  styleSheets: null, /* list of StyleSheet objects for this target */

  initialize: function(callback) {
    this._connect(function() {
      this._client.addListener("styleSheetAdded", this._onStyleSheetsAdded);

      this.reset(callback);
    }.bind(this));
  },
  _connect: function(callback) {
    if (this._target.client) {
      this._client = this._target.client;
      this._actor = this._target.form.styleEditorActor;
      callback();
    }
    else {
      if (!DebuggerServer.initialized) {
        DebuggerServer.init();
        DebuggerServer.addBrowserActors();
      }

      let transport = DebuggerServer.connectPipe();
      this._client = new DebuggerClient(transport);

      this._client.connect(function(type, traits) {
        this._client.listTabs(function (response) {
          let tab = response.tabs[response.selected];
          this._actor = tab.styleEditorActor;
          callback();
        }.bind(this));
      }.bind(this))
    }
  },

  clear: function(callback) {
    this.styleSheets = [];

    this.emit("stylesheets-changed");
  },

  reset: function(callback) {
    this._fetchStyleSheets(function(forms) {
      this.styleSheets = [];
      for (let form of forms) {
        this._addStyleSheet(form);
      }

      if (callback) {
        callback();
      }
      this.emit("stylesheets-changed");
    }.bind(this));
  },

  _onStyleSheetsAdded: function(type, request) {
    dump("HEATHER: type " + type + " request: " + JSON.stringify(request) + "\n");
    for (let form of request.styleSheets) {
      let sheet = this._addStyleSheet(form);
      this.emit("stylesheet-added", sheet);
    }
  },

  _addStyleSheet: function(form) {
    var sheet = new StyleSheet(form, this._client);
    this.styleSheets.push(sheet);
    return sheet;
  },

  _fetchStyleSheets: function(callback) {
    var message = { to: this._actor, type: "getStyleSheets" };
    this._client.request(message, function(response) {
      callback(response.styleSheets);
    });
  }
}
