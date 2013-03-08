/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

this.EXPORTED_SYMBOLS = ["StyleEditorPanel"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource:///modules/devtools/StyleEditorDebuggee.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUI.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUtil.jsm");


XPCOMUtils.defineLazyModuleGetter(this, "StyleEditorChrome",
                        "resource:///modules/devtools/StyleEditorChrome.jsm");

this.StyleEditorPanel = function StyleEditorPanel(panelWin, toolbox) {
  EventEmitter.decorate(this);

  this._showError = this._showError.bind(this);

  this._toolbox = toolbox;
  this._target = toolbox.target;
  this._panelDoc = panelWin.document;
}

StyleEditorPanel.prototype = {
  /**
   * open is effectively an asynchronous constructor
   */
  open: function() {
    let deferred = Promise.defer();

    let contentWin = this._toolbox.target.window;

    var debuggee = new StyleEditorDebuggee(this._toolbox.target);
    debuggee.initialize(function() {
      let styleEditorUI = new StyleEditorUI(debuggee, this._panelDoc);
      styleEditorUI.initialize();
      styleEditorUI.on("error", this._showError);

      this._UI = styleEditorUI;

      this.isReady = true;
      deferred.resolve(this);
    }.bind(this));

    //this.setPage(contentWin);
    return deferred.promise;
  },

  _showError: function(event, errorCode) {
    let message = _(errorCode);
    let notificationBox = this._toolbox.getNotificationBox();
    let notification = notificationBox.getNotificationWithValue("styleeditor-error");
    if (!notification) {
      notificationBox.appendNotification(message,
        "styleeditor-error", "", notificationBox.PRIORITY_CRITICAL_LOW);
    }
  },

  /**
   * Select a stylesheet. TODO
   */
  selectStyleSheet: function(stylesheet, line, col) {
    this._UI.selectStyleSheet(stylesheet, line, col);
  },

  /**
   * Destroy StyleEditor. TODO
   */
  destroy: function() {
    if (!this._destroyed) {
      this._destroyed = true;
      this._target = null;
      this._toolbox = null;
      this._panelDoc = null;
    }

    return Promise.resolve(null);
  },
}
