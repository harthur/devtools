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
      this._client.addListener("styleSheetsAdded", this._onStyleSheetsAdded);

      this.reset();
      callback();
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

    this.emit("stylesheets-cleared");
  },

  reset: function(callback) {
    this._addLoadListener();
    dump("HEATHER: reset" + "\n");
    this.clear();

/*
    this._fetchStyleSheets(function(forms) {
      dump("HEATHER: reset forms " + forms.length + "\n");
      for (let form of forms) {
        dump("HEATHER: reset form " + form.href + "\n");
        this._addStyleSheet(form);
      }

      if (callback) {
        callback();
      }
      this.emit("stylesheets-reset");
    }.bind(this)); */
  },

  _onStyleSheetsAdded: function(type, request) {
    for (let form of request.styleSheets) {
      dump("HEATHER: stylesheet added " + form.href + "\n");
      this._addStyleSheet(form);
    }
  },

  _addStyleSheet: function(form) {
    dump("HEATHER: addstylesheet in debuggee"  + "\n");
    var sheet = new StyleSheet(form, this._client);
    this.styleSheets.push(sheet);
    this.emit("stylesheet-added", sheet);
  },

  createStyleSheet: function(text) {
    var message = { to: this._actor, type: "newStyleSheet", text: text }
    this._client.request(message, function(response) {
      let form = response.styleSheet;
      this._addStyleSheet(form);
    }.bind(this));
  },

  _addLoadListener: function() {
    var message = { to: this._actor, type: "addLoadListener" };
    this._client.request(message, function(response) {
      dump("HEATHER: added load listener" + response + "\n");
    });
  },

  _fetchStyleSheets: function(callback) {
    var message = { to: this._actor, type: "getStyleSheets" };
    this._client.request(message, function(response) {
      callback(response.styleSheets);
    });
  }
}
