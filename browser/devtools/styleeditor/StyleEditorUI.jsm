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
Cu.import("resource:///modules/devtools/StyleEditor.jsm");
Cu.import("resource:///modules/devtools/StyleEditorUtil.jsm");
Cu.import("resource:///modules/devtools/SplitView.jsm");

// max update frequency in ms (avoid potential typing lag and/or flicker)
// @see StyleEditor.updateStylesheet
const UPDATE_STYLESHEET_THROTTLE_DELAY = 500;

const STYLE_EDITOR_TEMPLATE = "stylesheet";

function StyleEditorUI(debuggee, panelDoc) {
  this._debuggee = debuggee;
  this._panelDoc = panelDoc;
  this._window = this._panelDoc.defaultView;
  this._root = this._panelDoc.getElementById("style-editor-chrome");

  this._editors = [];
  this._selectedStyleSheetIndex = -1;

  this._onStyleSheetAdded = this._onStyleSheetAdded.bind(this);
  this._onStyleSheetCreated = this._onStyleSheetCreated.bind(this);
  this._onStyleSheetsCleared = this._onStyleSheetsCleared.bind(this);

  debuggee.on("stylesheet-added", this._onStyleSheetAdded);
  debuggee.on("stylesheets-cleared", this._onStyleSheetsCleared);
}

StyleEditorUI.prototype = {
  initialize: function(callback) {
    this.createUI();
  },

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
   * Import style sheet from file and load it into the editor asynchronously.
   * "Load" action triggers when complete.
   *
   * @param mixed aFile
   *        Optional nsIFile or filename string.
   *        If not set a file picker will be shown.
   * @param nsIWindow aParentWindow
   *        Optional parent window for the file picker.
   */
  _importFromFile: function(file, parentWindow)
  {
    let onFileSelected = function(file) {
      if (file) {
        NetUtil.asyncFetch(file, function onAsyncFetch(stream, status) {
          if (!Components.isSuccessCode(status)) {
            // TODO: return this._signalError(LOAD_ERROR);
          }
          let source = NetUtil.readInputStreamToString(stream, stream.available());
          stream.close();

          this._debuggee.createStyleSheet(source, function(styleSheet) {
            this._onStyleSheetCreated(styleSheet, file);
          }.bind(this));
        }.bind(this));
      }
    }.bind(this);

    showFilePicker(file, false, parentWindow, onFileSelected);
  },

  _onStyleSheetsCleared: function() {
    this._editors = [];
    this._view.removeAll();
    this._selectedStyleSheetIndex = -1;

    this._root.classList.add("loading");
  },

  /* When a new/imported stylesheet has been added to the document */
  _onStyleSheetCreated: function(styleSheet, file) {
    this._addStyleSheetEditor(styleSheet, file, true);
  },

  _onStyleSheetAdded: function(event, styleSheet) {
    // this might be the first stylesheet, so remove loading indicator
    this._root.classList.remove("loading");
    this._addStyleSheetEditor(styleSheet);
  },

  _addStyleSheetEditor: function(styleSheet, file, isNew) {
    let editor = new StyleSheetEditor(styleSheet, this._window, file, isNew);
    editor.once("source-load", this._sourceLoaded.bind(this, editor));
    editor.on("property-change", this._summaryChange.bind(this, editor));
    this._editors.push(editor);

    // Queue editor loading. This helps responsivity during loading when
    // there are many heavy stylesheets.
    this._window.setTimeout(editor.fetchSource.bind(editor), 0);
  },

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
        wire(summary, ".stylesheet-enabled", function onToggleDisabled(event) {
          event.stopPropagation();
          event.target.blur();

          editor.toggleDisabled();
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

        // autofocus new stylesheet
        if (editor.styleSheet.isNew) {
          this._selectEditor(editor);
        }
      }.bind(this),

      onHide: function(summary, details, data) {
        // data.editor.onHide();
      },
      onShow: function(summary, details, data) {
        let editor = data.editor;
        if (!editor.sourceEditor) {
          // only initialize source editor when we switch to this view
          let inputElement = details.querySelector(".stylesheet-editor-input");
          editor.load(inputElement);
        }
      }
    });

    /* If this is the first stylesheet, select it */
    if (this._selectedStyleSheetIndex == -1
        && !this._styleSheetToSelect
        && editor.styleSheet.styleSheetIndex == 0) {
      this._selectEditor(editor);
    }
  },

  /*
  switchToSelectedSheet: function() {
    if (this._styleSheetToSelect) {
      let sheet = this._styleSheetToSelect.sheet;

      if ((sheet && editor.styleSheet == sheet) ||
          (editor.styleSheetIndex == 0 && sheet == null)) {
        selectEditor(editor);
      }
    }
  }, */

  _selectEditor: function(editor, line, col) {
    line = line || 1;
    col = col || 1;

    this._selectedStyleSheetIndex = editor.styleSheet.styleSheetIndex;

    editor.getSourceEditor().then(function() {
      editor.sourceEditor.setCaretPosition(line - 1, col - 1);
    });

    let summary = this._getSummaryElementForEditor(editor);
    this._view.activeSummary = summary;
  },

  _getSummaryElementForEditor: function(editor) {
    let index = editor.styleSheet.styleSheetIndex;
    return this._view.getSummaryElementByOrdinal(index);
  },

  /** TODO: fit to new remoting
   * selects a stylesheet and optionally moves the cursor to a selected line
   *
   * @param {CSSStyleSheet} [sheet]
   *        Stylesheet that should be selected. If a stylesheet is not passed
   *        and the editor is not initialized we focus the first stylesheet. If
   *        a stylesheet is not passed and the editor is initialized we ignore
   *        the call.
   * @param {Number} [line]
   *        Line to which the caret should be moved (one-indexed).
   * @param {Number} [col]
   *        Column to which the caret should be moved (one-indexed).
   */
  selectStyleSheet: function SEC_selectSheet(sheet, line, col)
  {
    let alreadyCalled = !!this._styleSheetToSelect;

    this._styleSheetToSelect = {
      sheet: sheet,
      line: line,
      col: col,
    };

    if (alreadyCalled) {
      return;
    }

    /* Switch to the editor for this sheet, if it exists yet.
       Otherwise each editor will be checked when it's created. */
    for each (let editor in this._editors) {
      if (editor.styleSheet == sheet) {
        this._selectEditor(editor);
        break;
      }
    }
  },

  _summaryChange: function(editor) {
    this._updateSummaryForEditor(editor);
  },

  /**
   * Update split view summary of given StyleEditor instance.
   *
   * @param StyleEditor editor
   * @param DOMElement aSummary
   *        Optional item's summary element to update. If none, item corresponding
   *        to passed editor is used.
   */
  _updateSummaryForEditor: function(editor, summary) {
    summary = summary || this._getSummaryElementForEditor(editor);
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
    this._view.setItemClassName(summary, flags.join(" "));

    let label = summary.querySelector(".stylesheet-name > label");
    label.setAttribute("value", editor.friendlyName);

    text(summary, ".stylesheet-title", editor.styleSheet.title || "");
    text(summary, ".stylesheet-rule-count",
      PluralForm.get(ruleCount, _("ruleCount.label")).replace("#1", ruleCount));
    // text(summary, ".stylesheet-error-message", editor.errorMessage);
  }
}

Cu.import("resource:///modules/source-editor.jsm");

function StyleSheetEditor(styleSheet, win, file, isNew) {
  EventEmitter.decorate(this);

  this.styleSheet = styleSheet;
  this._inputElement = null;
  this._sourceEditor = null;
  this._window = win;

  this._isNew = isNew;
  this.savedFile = file;

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

  this._focusOnSourceEditorReady = false;

  this.styleSheet.on("property-change", this._onPropertyChange);
}

StyleSheetEditor.prototype = {
  get sourceEditor() {
    return this._sourceEditor;
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

  fetchSource: function() {
    this.styleSheet.once("source-load", this._onSourceLoad);
    this.styleSheet.fetchSource();
  },

  _onSourceLoad: function(event, source) {
    this._state.text = source;
    this.emit("source-load");
  },

  _onPropertyChange: function(event) {
    this.emit("property-change");
  },

  load: function(inputElement) {
    this._inputElement = inputElement;

    let sourceEditor = new SourceEditor();
    let config = {
      initialText: this._state.text,
      showLineNumbers: true,
      mode: SourceEditor.MODES.CSS,
      readOnly: this._state.readOnly
      // keys: this._getKeyBindings() TODO: keybindings
    };

    sourceEditor.init(inputElement, config, function onSourceEditorReady() {
      //setupBracketCompletion(sourceEditor); TODO
      sourceEditor.addEventListener(SourceEditor.EVENTS.TEXT_CHANGED,
                                    function onTextChanged(aEvent) {
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
  },

  getSourceEditor: function() {
    let deferred = Promise.defer();

    if (this.sourceEditor) {
      deferred.resolve();
    }
    else {
      this.on("source-editor-load", function(event) {
        deferred.resolve();
      })
    }
    return deferred.promise;
  },

  /**
   * Focus the Style Editor input.
   */
  focus: function()
  {
    if (this._sourceEditor) {
      this._sourceEditor.focus();
    } else {
      this._focusOnSourceEditorReady = true;
    }
  },

  /**
   * Toggled the disabled state of the stylesheet.
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
  updateStyleSheet: function(immediate)
  {
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
  _updateStyleSheet: function()
  {
    // TODO: this.setFlag(StyleEditorFlags.UNSAVED);
    this.unSaved = true;
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

    //this._persistExpando(); TODO
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
  saveToFile: function(file, callback)
  {
    let callback = function(returnFile) {
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
          // TODO: this._signalError(SAVE_ERROR);
          return;
        }
        FileUtils.closeSafeFileOutputStream(ostream);

        // remember filename for next save if any
        this._friendlyName = null;
        this.savedFile = returnFile;
        // TODO: this._persistExpando();

        if (callback) {
          callback(returnFile);
        }
        //TODO: this.clearFlag(StyleEditorFlags.UNSAVED);
        //TODO: this.clearFlag(StyleEditorFlags.ERROR);
      }.bind(this));
    }.bind(this);

    showFilePicker(file || this._styleSheetFilePath, true, this._window, callback);
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
      // TODO
    }
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
      file.initWithPath(path);
      callback(file);
      return;
    } catch (ex) {
      // TODO: this._signalError(aSave ? SAVE_ERROR : LOAD_ERROR);
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
