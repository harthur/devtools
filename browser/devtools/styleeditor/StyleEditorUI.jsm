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
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUtil.jsm");
Cu.import("resource:///modules/devtools/SplitView.jsm");

const LOAD_ERROR = "error-load";
const SAVE_ERROR = "error-save";

// max update frequency in ms (avoid potential typing lag and/or flicker)
// @see StyleEditor.updateStylesheet
const UPDATE_STYLESHEET_THROTTLE_DELAY = 500;

const STYLE_EDITOR_TEMPLATE = "stylesheet";

/**
 * StyleEditorUI is controls and builds the UI of the Style Editor, including
 * maintaining a list of editors for each stylesheet on a debuggee.
 *
 * Emits events:
 *   'editor-added': A new editor was added to the UI
 *   'error': An error occured
 *
 * @param {StyleEditorDebuggee} debuggee
 *        Debuggee of whose stylesheets should be shown in the UI
 * @param {Document} panelDoc
 *        Document of the toolbox panel to populate UI in.
 */
function StyleEditorUI(debuggee, panelDoc) {
  EventEmitter.decorate(this);

  this._debuggee = debuggee;
  this._panelDoc = panelDoc;
  this._window = this._panelDoc.defaultView;
  this._root = this._panelDoc.getElementById("style-editor-chrome");

  this.editors = [];
  this.selectedStyleSheetIndex = -1;

  this._onStyleSheetAdded = this._onStyleSheetAdded.bind(this);
  this._onStyleSheetCreated = this._onStyleSheetCreated.bind(this);
  this._onStyleSheetsCleared = this._onStyleSheetsCleared.bind(this);
  this._onError = this._onError.bind(this);

  debuggee.on("stylesheet-added", this._onStyleSheetAdded);
  debuggee.on("stylesheets-cleared", this._onStyleSheetsCleared);

  this.createUI();
}

StyleEditorUI.prototype = {
  /**
   * Get whether any of the editors have unsaved changes.
   *
   * @return boolean
   */
  get isDirty()
  {
    if (this._markedDirty === true) {
      return true;
    }
    return this.editors.some(function(editor) {
      return editor.sourceEditor && editor.sourceEditor.dirty;
    });
  },

  /*
   * Mark the style editor as having or not having unsaved changes.
   */
  set isDirty(value) {
    this._markedDirty = value;
  },

  /**
   * Build the initial UI and wire buttons with event handlers.
   */
  createUI: function() {
    let viewRoot = this._root.parentNode.querySelector(".splitview-root");

    this._view = new SplitView(viewRoot);

    wire(this._view.rootElement, ".style-editor-newButton", function onNew() {
      this._debuggee.createStyleSheet(null, this._onStyleSheetCreated);
    }.bind(this));

    wire(this._view.rootElement, ".style-editor-importButton", function onImport() {
      this._importFromFile(this._mockImportFile || null, this._window);
    }.bind(this));
  },

  /**
   * Import a style sheet from file and asynchronously create a
   * new stylesheet on the debuggee for it.
   *
   * @param {mixed} file
   *        Optional nsIFile or filename string.
   *        If not set a file picker will be shown.
   * @param {nsIWindow} parentWindow
   *        Optional parent window for the file picker.
   */
  _importFromFile: function(file, parentWindow)
  {
    let onFileSelected = function(file) {
      if (!file) {
        this.emit("error", LOAD_ERROR);
        return;
      }
      NetUtil.asyncFetch(file, function onAsyncFetch(stream, status) {
        if (!Components.isSuccessCode(status)) {
          this.emit("error", LOAD_ERROR);
          return;
        }
        let source = NetUtil.readInputStreamToString(stream, stream.available());
        stream.close();

        this._debuggee.createStyleSheet(source, function(styleSheet) {
          this._onStyleSheetCreated(styleSheet, file);
        }.bind(this));
      }.bind(this));

    }.bind(this);

    showFilePicker(file, false, parentWindow, onFileSelected);
  },

  /**
   * Handler for debuggee's 'stylesheets-cleared' event. Remove all editors.
   */
  _onStyleSheetsCleared: function() {
    this._clearStyleSheetEditors();

    this._view.removeAll();
    this.selectedStyleSheetIndex = -1;

    this._root.classList.add("loading");
  },

  /**
   * When a new or imported stylesheet has been added to the document.
   * Add an editor for it.
   */
  _onStyleSheetCreated: function(styleSheet, file) {
    this._addStyleSheetEditor(styleSheet, file, true);
  },

  /**
   * Handler for debuggee's 'stylesheet-added' event. Add an editor.
   *
   * @param {string} event
   *        Event name
   * @param {StyleSheet} styleSheet
   *        StyleSheet object for new sheet
   */
  _onStyleSheetAdded: function(event, styleSheet) {
    // this might be the first stylesheet, so remove loading indicator
    this._root.classList.remove("loading");
    this._addStyleSheetEditor(styleSheet);
  },

  /**
   * Forward any error from a stylesheet.
   *
   * @param  {string} event
   *         Event name
   * @param  {string} errorCode
   *         Code represeting type of error
   */
  _onError: function(event, errorCode) {
    this.emit("error", errorCode);
  },

  /**
   * Add a new editor to the UI for a stylesheet.
   *
   * @param {StyleSheet}  styleSheet
   *        Object representing stylesheet
   * @param {nsIfile}  file
   *         Optional file object that sheet was imported from
   * @param {Boolean} isNew
   *         Optional if stylesheet is a new sheet created by user
   */
  _addStyleSheetEditor: function(styleSheet, file, isNew) {
    let editor = new StyleSheetEditor(styleSheet, this._window, file, isNew);

    editor.once("source-load", this._sourceLoaded.bind(this, editor));
    editor.on("property-change", this._summaryChange.bind(this, editor));
    editor.on("style-applied", this._summaryChange.bind(this, editor));
    editor.on("error", this._onError);

    this.editors.push(editor);

    // Queue editor loading. This helps responsivity during loading when
    // there are many heavy stylesheets.
    this._window.setTimeout(editor.fetchSource.bind(editor), 0);
  },

  /**
   * Clear all the editors from the UI.
   */
  _clearStyleSheetEditors: function() {
    for (let editor of this.editors) {
      editor.destroy();
    }
    this.editors = [];
  },

  /**
   * Handler for an StyleSheetEditor's 'source-load' event.
   * Create a summary UI for the editor.
   *
   * @param  {StyleSheetEditor} editor
   *         Editor to create UI for.
   */
  _sourceLoaded: function(editor) {
    // add new sidebar item and editor to the UI
    this._view.appendTemplatedItem(STYLE_EDITOR_TEMPLATE, {
      data: {
        editor: editor
      },
      disableAnimations: this._alwaysDisableAnimations,
      ordinal: editor.styleSheet.styleSheetIndex,
      onCreate: function(summary, details, data) {
        let editor = data.editor;
        editor.summary = summary;

        wire(summary, ".stylesheet-enabled", function onToggleDisabled(event) {
          event.stopPropagation();
          event.target.blur();

          editor.toggleDisabled();
        });

        wire(summary, ".stylesheet-name", {
          events: {
            "keypress": function onStylesheetNameActivate(aEvent) {
              if (aEvent.keyCode == aEvent.DOM_VK_RETURN) {
                this._view.activeSummary = summary;
              }
            }.bind(this)
          }
        });

        wire(summary, ".stylesheet-saveButton", function onSaveButton(event) {
          event.stopPropagation();
          event.target.blur();

          editor.saveToFile(editor.savedFile);
        });

        this._updateSummaryForEditor(editor, summary);

        summary.addEventListener("focus", function onSummaryFocus(event) {
          if (event.target == summary) {
            // autofocus the stylesheet name
            summary.querySelector(".stylesheet-name").focus();
          }
        }, false);

        // autofocus if it's a new user-created stylesheet
        if (editor.isNew) {
          this._selectEditor(editor);
        }

        if (this._styleSheetToSelect
            && this._styleSheetToSelect.href == editor.styleSheet.href) {
          this.switchToSelectedSheet();
        }

        // If this is the first stylesheet, select it
        if (this.selectedStyleSheetIndex == -1
            && !this._styleSheetToSelect
            && editor.styleSheet.styleSheetIndex == 0) {
          this._selectEditor(editor);
        }

        this.emit("editor-added", editor);
      }.bind(this),

      onShow: function(summary, details, data) {
        let editor = data.editor;
        if (!editor.sourceEditor) {
          // only initialize source editor when we switch to this view
          let inputElement = details.querySelector(".stylesheet-editor-input");
          editor.load(inputElement);
        }
        editor.onShow();
      }
    });
  },

  /**
   * Switch to the editor that has been marked to be selected.
   */
  switchToSelectedSheet: function() {
    let sheet = this._styleSheetToSelect;

    for each (let editor in this.editors) {
      if (editor.styleSheet.href == sheet.href) {
        this._selectEditor(editor, sheet.line, sheet.col);
        this._styleSheetToSelect = null;
        break;
      }
    }
  },

  /**
   * Select an editor in the UI.
   *
   * @param  {StyleSheetEditor} editor
   *         Editor to switch to.
   * @param  {number} line
   *         Line number to jump to
   * @param  {number} col
   *         Column number to jump to
   */
  _selectEditor: function(editor, line, col) {
    line = line || 1;
    col = col || 1;

    this.selectedStyleSheetIndex = editor.styleSheet.styleSheetIndex;

    editor.getSourceEditor().then(function() {
      editor.sourceEditor.setCaretPosition(line - 1, col - 1);
    });

    this._view.activeSummary = editor.summary;
  },

  /**
   * selects a stylesheet and optionally moves the cursor to a selected line
   *
   * @param {string} [href]
   *        Href of stylesheet that should be selected. If a stylesheet is not passed
   *        and the editor is not initialized we focus the first stylesheet. If
   *        a stylesheet is not passed and the editor is initialized we ignore
   *        the call.
   * @param {Number} [line]
   *        Line to which the caret should be moved (one-indexed).
   * @param {Number} [col]
   *        Column to which the caret should be moved (one-indexed).
   */
  selectStyleSheet: function(href, line, col)
  {
    let alreadyCalled = !!this._styleSheetToSelect;

    this._styleSheetToSelect = {
      href: href,
      line: line,
      col: col,
    };

    if (alreadyCalled) {
      return;
    }

    /* Switch to the editor for this sheet, if it exists yet.
       Otherwise each editor will be checked when it's created. */
    this.switchToSelectedSheet();
  },


  /**
   * Handler for an editor's 'property-changed' event.
   * Update the summary in the UI.
   *
   * @param  {StyleSheetEditor} editor
   *         Editor for which a property has changed
   */
  _summaryChange: function(editor) {
    this._updateSummaryForEditor(editor);
  },

  /**
   * Update split view summary of given StyleEditor instance.
   *
   * @param {StyleSheetEditor} editor
   * @param {DOMElement} summary
   *        Optional item's summary element to update. If none, item corresponding
   *        to passed editor is used.
   */
  _updateSummaryForEditor: function(editor, summary) {
    summary = summary || editor.summary;
    if (!summary) {
      return;
    }
    let ruleCount = "-";
    if (editor.styleSheet.cssRules) {
      ruleCount = editor.styleSheet.cssRules.length;
    }

    var flags = [];
    if (editor.styleSheet.disabled) {
      flags.push("disabled");
    }
    if (editor.unsaved) {
      flags.push("unsaved");
    }
    this._view.setItemClassName(summary, flags.join(" "));

    let label = summary.querySelector(".stylesheet-name > label");
    label.setAttribute("value", editor.friendlyName);

    text(summary, ".stylesheet-title", editor.styleSheet.title || "");
    text(summary, ".stylesheet-rule-count",
      PluralForm.get(ruleCount, _("ruleCount.label")).replace("#1", ruleCount));
    text(summary, ".stylesheet-error-message", editor.errorMessage);
  },

  destroy: function() {
    this._clearStyleSheetEditors();

    this._debuggee.off("stylesheet-added", this._onStyleSheetAdded);
    this._debuggee.off("stylesheets-cleared", this._onStyleSheetsCleared);
  }
}

Cu.import("resource:///modules/source-editor.jsm");


/**
 * StyleEditorUI is controls and builds the UI of the Style Editor, including
 * maintaining a list of editors for each stylesheet on a debuggee.
 *
 * Emits events:
 *   'editor-added': A new editor was added to the UI
 *   'error': An error occured
 *
 * @param {StyleEditorDebuggee} debuggee
 *        Debuggee of whose stylesheets should be shown in the UI
 * @param {Document} panelDoc
 *        Document of the toolbox panel to populate UI in.
 */

/**
 * StyleSheetEditor controls the editor linked to a particular StyleSheet
 * object.
 *
 * Emits events:
 *   'source-load': The source of the stylesheet has been fetched
 *   'property-change': A property on the underlying stylesheet has changed
 *   'source-editor-load': The source editor for this editor has been loaded
 *   'error': An error has occured
 *
 * @param {StyleSheet}  styleSheet
 * @param {DOMWindow}  win
 *        panel window for style editor
 * @param {nsIFile}  file
 *        Optional file that the sheet was imported from
 * @param {boolean} isNew
 *        Optional whether the sheet was created by the user
 */
function StyleSheetEditor(styleSheet, win, file, isNew) {
  EventEmitter.decorate(this);

  this.styleSheet = styleSheet;
  this._inputElement = null;
  this._sourceEditor = null;
  this._window = win;
  this._isNew = isNew;
  this.savedFile = file;

  this.errorMessage = null;

  this._state = {   // state to use when inputElement attaches
    text: "",
    selection: {start: 0, end: 0},
    readOnly: false,
    topIndex: 0,              // the first visible line
  };

  this._styleSheetFilePath = null;
  if (styleSheet.href &&
      Services.io.extractScheme(this.styleSheet.href) == "file") {
    this._styleSheetFilePath = this.styleSheet.href;
  }

  this._onSourceLoad = this._onSourceLoad.bind(this);
  this._onPropertyChange = this._onPropertyChange.bind(this);
  this._onError = this._onError.bind(this);

  this._focusOnSourceEditorReady = false;

  this.styleSheet.once("source-load", this._onSourceLoad);
  this.styleSheet.on("property-change", this._onPropertyChange);
  this.styleSheet.on("error", this._onError);
}

StyleSheetEditor.prototype = {
  /**
   * This editor's source editor
   */
  get sourceEditor() {
    return this._sourceEditor;
  },

  /**
   * Whether there are unsaved changes in the editor
   */
  get unsaved() {
    return this._sourceEditor && this._sourceEditor.dirty;
  },

  /**
   * Whether the editor is for a stylesheet created by the user
   * through the style editor UI.
   */
  get isNew() {
    return this._isNew;
  },

  /**
   * Get a user-friendly name for the style sheet.
   *
   * @return string
   */
  get friendlyName() {
    if (this.savedFile) { // reuse the saved filename if any
      return this.savedFile.leafName;
    }

    if (this._isNew) {
      let index = this.styleSheet.styleSheetIndex + 1; // 0-indexing only works for devs
      return _("newStyleSheet", index);
    }

    if (!this.styleSheet.href) {
      let index = this.styleSheet.styleSheetIndex + 1; // 0-indexing only works for devs
      return _("inlineStyleSheet", index);
    }

    if (!this._friendlyName) {
      let sheetURI = this.styleSheet.href;
      let contentURI = this.styleSheet.debuggee.baseURI;
      let contentURIScheme = contentURI.scheme;
      let contentURILeafIndex = contentURI.specIgnoringRef.lastIndexOf("/");
      contentURI = contentURI.specIgnoringRef;

      // get content base URI without leaf name (if any)
      if (contentURILeafIndex > contentURIScheme.length) {
        contentURI = contentURI.substring(0, contentURILeafIndex + 1);
      }

      // avoid verbose repetition of absolute URI when the style sheet URI
      // is relative to the content URI
      this._friendlyName = (sheetURI.indexOf(contentURI) == 0)
                           ? sheetURI.substring(contentURI.length)
                           : sheetURI;
      try {
        this._friendlyName = decodeURI(this._friendlyName);
      } catch (ex) {
      }
    }
    return this._friendlyName;
  },

  /**
   * Start fetching the full text source for this editor's sheet.
   */
  fetchSource: function() {
    this.styleSheet.fetchSource();
  },

  /**
   * Handle source fetched event. Forward source-load event.
   *
   * @param  {string} event
   *         Event type
   * @param  {string} source
   *         Full-text source of the stylesheet
   */
  _onSourceLoad: function(event, source) {
    this._state.text = prettifyCSS(source);
    this.sourceLoaded = true;
    this.emit("source-load");
  },

  /**
   * Forward property-change event from stylesheet.
   *
   * @param  {string} event
   *         Event type
   * @param  {string} property
   *         Property that has changed on sheet
   */
  _onPropertyChange: function(event, property) {
    this.emit("property-change", property);
  },

  /**
   * Forward error event from stylesheet.
   *
   * @param  {string} event
   *         Event type
   * @param  {string} errorCode
   */
  _onError: function(event, errorCode) {
    this.emit("error", errorCode);
  },

  /**
   * Create source editor and load state into it.
   * @param  {DOMElement} inputElement
   *         Element to load source editor in
   */
  load: function(inputElement) {
    this._inputElement = inputElement;

    let sourceEditor = new SourceEditor();
    let config = {
      initialText: this._state.text,
      showLineNumbers: true,
      mode: SourceEditor.MODES.CSS,
      readOnly: this._state.readOnly,
      keys: this._getKeyBindings()
    };

    sourceEditor.init(inputElement, config, function onSourceEditorReady() {
      setupBracketCompletion(sourceEditor);
      sourceEditor.addEventListener(SourceEditor.EVENTS.TEXT_CHANGED,
                                    function onTextChanged(event) {
        this.updateStyleSheet();
      }.bind(this));

      this._sourceEditor = sourceEditor;

      if (this._focusOnSourceEditorReady) {
        this._focusOnSourceEditorReady = false;
        sourceEditor.focus();
      }

      sourceEditor.setTopIndex(this._state.topIndex);
      sourceEditor.setSelection(this._state.selection.start,
                                this._state.selection.end);

      this.emit("source-editor-load");
    }.bind(this));

    sourceEditor.addEventListener(SourceEditor.EVENTS.DIRTY_CHANGED,
                                  this._onPropertyChange);
  },

  /**
   * Get the source editor for this editor.
   *
   * @return {Promise}
   *         Promise that will resolve with the editor.
   */
  getSourceEditor: function() {
    let deferred = Promise.defer();

    if (this.sourceEditor) {
      return Promise.resolve(this);
    }
    this.on("source-editor-load", function(event) {
      deferred.resolve(this);
    }.bind(this))
    return deferred.promise;
  },

  /**
   * Focus the Style Editor input.
   */
  focus: function() {
    if (this._sourceEditor) {
      this._sourceEditor.focus();
    } else {
      this._focusOnSourceEditorReady = true;
    }
  },

  /**
   * Event handler for when the editor is shown.
   */
  onShow: function() {
    if (this._sourceEditor) {
      this._sourceEditor.setTopIndex(this._state.topIndex);
    }
    this.focus();
  },

  /**
   * Toggled the disabled state of the underlying stylesheet.
   */
  toggleDisabled: function() {
    this.styleSheet.toggleDisabled();
  },

  /**
   * Queue a throttled task to update the live style sheet.
   *
   * @param boolean immediate
   *        Optional. If true the update is performed immediately.
   */
  updateStyleSheet: function(immediate) {
    if (this._updateTask) {
      // cancel previous queued task not executed within throttle delay
      this._window.clearTimeout(this._updateTask);
    }

    if (immediate) {
      this._updateStyleSheet();
    } else {
      this._updateTask = this._window.setTimeout(this._updateStyleSheet.bind(this),
                                           UPDATE_STYLESHEET_THROTTLE_DELAY);
    }
  },

  /**
   * Update live style sheet according to modifications.
   */
  _updateStyleSheet: function() {
    if (this.styleSheet.disabled) {
      return;  // TODO: do we want to do this?
    }

    this._updateTask = null; // reset only if we actually perform an update
                             // (stylesheet is enabled) so that 'missed' updates
                             // while the stylesheet is disabled can be performed
                             // when it is enabled back. @see enableStylesheet

    if (this.sourceEditor) {
      this._state.text = this.sourceEditor.getText();
    }

    this.styleSheet.update(this._state.text);
  },

  /**
   * Save the editor contents into a file and set savedFile property.
   * A file picker UI will open if file is not set and editor is not headless.
   *
   * @param mixed file
   *        Optional nsIFile or string representing the filename to save in the
   *        background, no UI will be displayed.
   *        If not specified, the original style sheet URI is used.
   *        To implement 'Save' instead of 'Save as', you can pass savedFile here.
   * @param function(nsIFile aFile) callback
   *        Optional callback called when the operation has finished.
   *        aFile has the nsIFile object for saved file or null if the operation
   *        has failed or has been canceled by the user.
   * @see savedFile
   */
  saveToFile: function(file, callback) {
    let onFile = function(returnFile) {
      if (!returnFile) {
        if (callback) {
          callback(null);
        }
        return;
      }

      if (this._sourceEditor) {
        this._state.text = this._sourceEditor.getText();
      }

      let ostream = FileUtils.openSafeFileOutputStream(returnFile);
      let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                        .createInstance(Ci.nsIScriptableUnicodeConverter);
      converter.charset = "UTF-8";
      let istream = converter.convertToInputStream(this._state.text);

      NetUtil.asyncCopy(istream, ostream, function SE_onStreamCopied(status) {
        if (!Components.isSuccessCode(status)) {
          if (callback) {
            callback(null);
          }
          this.emit("error", SAVE_ERROR);
          return;
        }
        FileUtils.closeSafeFileOutputStream(ostream);
        // remember filename for next save if any
        this._friendlyName = null;
        this.savedFile = returnFile;

        if (callback) {
          callback(returnFile);
        }
        this.sourceEditor.dirty = false;
      }.bind(this));
    }.bind(this);

    showFilePicker(file || this._styleSheetFilePath, true, this._window, onFile);
  },

  /**
    * Retrieve custom key bindings objects as expected by SourceEditor.
    * SourceEditor action names are not displayed to the user.
    *
    * @return {array} key binding objects for the source editor
    */
  _getKeyBindings: function() {
    let bindings = [];

    bindings.push({
      action: "StyleEditor.save",
      code: _("saveStyleSheet.commandkey"),
      accel: true,
      callback: function save() {
        this.saveToFile(this.savedFile);
        return true;
      }.bind(this)
    });

    bindings.push({
      action: "StyleEditor.saveAs",
      code: _("saveStyleSheet.commandkey"),
      accel: true,
      shift: true,
      callback: function saveAs() {
        this.saveToFile();
        return true;
      }.bind(this)
    });

    return bindings;
  },

  /**
   * Clean up for this editor.
   */
  destroy: function() {
    this.styleSheet.off("source-load", this._onSourceLoad);
    this.styleSheet.off("property-change", this._onPropertyChange);
    this.styleSheet.off("error", this._onError);
  }
}

/**
 * Show file picker and return the file user selected.
 *
 * @param mixed file
 *        Optional nsIFile or string representing the filename to auto-select.
 * @param boolean toSave
 *        If true, the user is selecting a filename to save.
 * @param nsIWindow parentWindow
 *        Optional parent window. If null the parent window of the file picker
 *        will be the window of the attached input element.
 * @param callback
 *        The callback method, which will be called passing in the selected
 *        file or null if the user did not pick one.
 */
function showFilePicker(path, toSave, parentWindow, callback)
{
  if (typeof(path) == "string") {
    try {
      if (Services.io.extractScheme(path) == "file") {
        let uri = Services.io.newURI(path, null, null);
        let file = uri.QueryInterface(Ci.nsIFileURL).file;
        callback(file);
        return;
      }
    } catch (ex) {
      callback(null);
      return;
    }
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
      file.initWithPath(path);
      callback(file);
      return;
    } catch (ex) {
      callback(null);
      return;
    }
  }
  if (path) { // "path" is an nsIFile
    callback(path);
    return;
  }

  let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  let mode = toSave ? fp.modeSave : fp.modeOpen;
  let key = toSave ? "saveStyleSheet" : "importStyleSheet";
  let fpCallback = function(result) {
    if (result == Ci.nsIFilePicker.returnCancel) {
      callback(null);
    } else {
      callback(fp.file);
    }
  };

  fp.init(parentWindow, _(key + ".title"), mode);
  fp.appendFilters(_(key + ".filter"), "*.css");
  fp.appendFilters(fp.filterAll);
  fp.open(fpCallback);
  return;
}

const TAB_CHARS = "\t";

const OS = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).OS;
const LINE_SEPARATOR = OS === "WINNT" ? "\r\n" : "\n";

/**
 * Prettify minified CSS text.
 * This prettifies CSS code where there is no indentation in usual places while
 * keeping original indentation as-is elsewhere.
 *
 * @param string text
 *        The CSS source to prettify.
 * @return string
 *         Prettified CSS source
 */
function prettifyCSS(text)
{
  // remove initial and terminating HTML comments and surrounding whitespace
  text = text.replace(/(?:^\s*<!--[\r\n]*)|(?:\s*-->\s*$)/g, "");

  let parts = [];    // indented parts
  let partStart = 0; // start offset of currently parsed part
  let indent = "";
  let indentLevel = 0;

  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    let shouldIndent = false;

    switch (c) {
      case "}":
        if (i - partStart > 1) {
          // there's more than just } on the line, add line
          parts.push(indent + text.substring(partStart, i));
          partStart = i;
        }
        indent = repeat(TAB_CHARS, --indentLevel);
        /* fallthrough */
      case ";":
      case "{":
        shouldIndent = true;
        break;
    }

    if (shouldIndent) {
      let la = text[i+1]; // one-character lookahead
      if (!/\s/.test(la)) {
        // following character should be a new line (or whitespace) but it isn't
        // force indentation then
        parts.push(indent + text.substring(partStart, i + 1));
        if (c == "}") {
          parts.push(""); // for extra line separator
        }
        partStart = i + 1;
      } else {
        return text; // assume it is not minified, early exit
      }
    }

    if (c == "{") {
      indent = repeat(TAB_CHARS, ++indentLevel);
    }
  }
  return parts.join(LINE_SEPARATOR);
}

/**
  * Return string that repeats text for aCount times.
  *
  * @param string text
  * @param number aCount
  * @return string
  */
function repeat(text, aCount)
{
  return (new Array(aCount + 1)).join(text);
}

/**
 * Set up bracket completion on a given SourceEditor.
 * This automatically closes the following CSS brackets: "{", "(", "["
 *
 * @param SourceEditor sourceEditor
 */
function setupBracketCompletion(sourceEditor)
{
  let editorElement = sourceEditor.editorElement;
  let pairs = {
    123: { // {
      closeString: "}",
      closeKeyCode: Ci.nsIDOMKeyEvent.DOM_VK_CLOSE_BRACKET
    },
    40: { // (
      closeString: ")",
      closeKeyCode: Ci.nsIDOMKeyEvent.DOM_VK_0
    },
    91: { // [
      closeString: "]",
      closeKeyCode: Ci.nsIDOMKeyEvent.DOM_VK_CLOSE_BRACKET
    },
  };

  editorElement.addEventListener("keypress", function onKeyPress(event) {
    let pair = pairs[event.charCode];
    if (!pair || event.ctrlKey || event.metaKey ||
        event.accelKey || event.altKey) {
      return true;
    }

    // We detected an open bracket, sending closing character
    let keyCode = pair.closeKeyCode;
    let charCode = pair.closeString.charCodeAt(0);
    let modifiers = 0;
    let utils = editorElement.ownerDocument.defaultView.
                  QueryInterface(Ci.nsIInterfaceRequestor).
                  getInterface(Ci.nsIDOMWindowUtils);
    let handled = utils.sendKeyEvent("keydown", keyCode, 0, modifiers);
    utils.sendKeyEvent("keypress", 0, charCode, modifiers, !handled);
    utils.sendKeyEvent("keyup", keyCode, 0, modifiers);
    // and rewind caret
    sourceEditor.setCaretOffset(sourceEditor.getCaretOffset() - 1);
  }, false);
}
