/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleSheet"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");

let StyleSheet = function(form, client) {
  EventEmitter.decorate(this);

  this._client = client;
  this._actor = form.actor;

  this._onSourceLoad = this._onSourceLoad.bind(this);

  this._client.addListener("sourceLoad-" + this._actor, this._onSourceLoad);

  // include everything from the form like href, title
  for (var attr in form) {
    this[attr] = form[attr];
  }
}

StyleSheet.prototype = {
  getDisabled : function(callback) {
    let message = { type: "getDisabled" };
    this._sendRequest(message, function(response) {
      callback(response.disabled);
    });
  },

  fetchSource: function() {
    let message = { type: "fetchSource" };
    this._sendRequest(message, function(response) {
      // TODO: err handling
    })
  },

  update: function(sheetText) {
    dump("HEATHER: update from StyleSheet.jsm: " + sheetText.length + "\n");
   /* let message = { type: "update", text: sheetText };
    this._sendRequest(message, function(response) {
      dump("HEATHER: response: " + response + "\n");
    });
*/
    let message = { to: this._actor, type: "update", text: sheetText};
    this._client.request(message, function() {
      dump("HEATHER: response" + "\n");
    });
  },

  _sendRequest: function(message, callback) {
    message.to = this._actor;
    this._client.request(message, callback);
  },

  _onSourceLoad: function(type, request) {
    this.emit("source-load", request.source);
  }
}
