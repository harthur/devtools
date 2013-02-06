/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["StyleEditorUI"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PluralForm.jsm");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource:///modules/devtools/StyleEditor.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUtil.jsm");
Cu.import("resource:///modules/devtools/SplitView.jsm");


const STYLE_EDITOR_TEMPLATE = "stylesheet";

function StyleEditorUI(debuggee, panelDoc) {
  this._debuggee = debuggee;
  this._panelDoc = panelDoc;
  this._sheets = [];
}

StyleEditorUI.prototype = {
  initialize: function(callback) {
    this.createUI();
  },

  createUI: function() {
    let rootElem = this._panelDoc.getElementById("style-editor-chrome");
    this._view = new SplitView(rootElem);

    dump("HEATHER: view " + this._view + "\n");

    // wire "New" button
    // wire "Import" button

    // create StylesheetEditor objects
    // load editors, after loading add items to UI for them

  },

  populateStyleSheets: function() {

  }
}
