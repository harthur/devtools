/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleEditorClient", "StyleSheet"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource://gre/modules/devtools/dbg-server.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
Cu.import("resource:///modules/devtools/StyleSheet.jsm");


let StyleEditorClient = function(target) {
  EventEmitter.decorate(this);
  this._target = target;
}

StyleEditorClient.prototype = {
  styleSheets: null, /* list of StyleSheet objects for this target */

  initialize: function(callback) {
    this.connect(function() {
      this.reset(callback);
    }.bind(this));
  },

  reset: function(callback) {
    this.fetchStyleSheets(function(forms) {
      this.setStyleSheets(forms);
      callback();
    }.bind(this));
  },

  connect: function(callback) {
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

  fetchStyleSheets: function(callback) {
    var message = { to: this._actor, type: "getStyleSheets" };
    this._client.request(message, function(response) {
      callback(response.styleSheets);
    });
  },

  setStyleSheets: function(styleSheetForms) {
    this.styleSheets = [];
    for (let form of styleSheetForms) {
      var sheet = new StyleSheet(form, this._client);
      this.styleSheets.push(sheet);
    }
  }
}
