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

  this._onStyleSheetAdded = this._onStyleSheetAdded.bind(this);
  this._onStyleSheetsCleared = this._onStyleSheetsCleared.bind(this);
  this._onStyleSheetsReset = this._onStyleSheetsReset.bind(this);

  debuggee.on("stylesheet-added", this._onStyleSheetAdded);
  debuggee.on("stylesheets-cleared", this._onStyleSheetsCleared);
  debuggee.on("stylesheets-reset", this._onStyleSheetsReset);
}

StyleEditorUI.prototype = {
  initialize: function(callback) {
    this.createUI();
  },

  createUI: function() {
    let viewRoot = this._root.parentNode.querySelector(".splitview-root");

    this._view = new SplitView(viewRoot);

    wire(this._view.rootElement, ".style-editor-newButton", function onNewButton() {
      this._debuggee.createStyleSheet();
    }.bind(this));

    wire(this._view.rootElement, ".style-editor-importButton", function onImportButton() {
      // TODO: implement file import
      editor.importFromFile(this._mockImportFile || null, this._window);
      this._debuggee.createStyleSheet();
    }.bind(this));
  },

  _onStyleSheetsCleared: function() {
    this._editors = [];
    this._view.removeAll();

    let matches = this._root.querySelectorAll("toolbarbutton,input,select");
    for (let i = 0; i < matches.length; i++) {
      matches[i].removeAttribute("disabled");
    }

    this._root.classList.add("loading");
  },

  _onStyleSheetsReset: function() {
    this._root.classList.remove("loading");
    this.resetEditors();
  },

  /** TODO: fit to new remoting
   * selects a stylesheet and optionally moves the cursor to a selected line
   *
   * @param {CSSStyleSheet} [aSheet]
   *        Stylesheet that should be selected. If a stylesheet is not passed
   *        and the editor is not initialized we focus the first stylesheet. If
   *        a stylesheet is not passed and the editor is initialized we ignore
   *        the call.
   * @param {Number} [aLine]
   *        Line to which the caret should be moved (one-indexed).
   * @param {Number} [aCol]
   *        Column to which the caret should be moved (one-indexed).
   */
  selectStyleSheet: function SEC_selectSheet(aSheet, aLine, aCol)
  {
    let alreadyCalled = !!this._styleSheetToSelect;

    this._styleSheetToSelect = {
      sheet: aSheet,
      line: aLine,
      col: aCol,
    };

    if (alreadyCalled) {
      return;
    }

    let select = function DEC_select(aEditor) {
      let sheet = this._styleSheetToSelect.sheet;
      let line = this._styleSheetToSelect.line || 1;
      let col = this._styleSheetToSelect.col || 1;

      if (!aEditor.sourceEditor) {
        let onAttach = function SEC_selectSheet_onAttach() {
          aEditor.removeActionListener(this);
          this.selectedStyleSheetIndex = aEditor.styleSheetIndex;
          aEditor.sourceEditor.setCaretPosition(line - 1, col - 1);

          let newSheet = this._styleSheetToSelect.sheet;
          let newLine = this._styleSheetToSelect.line;
          let newCol = this._styleSheetToSelect.col;
          this._styleSheetToSelect = null;
          if (newSheet != sheet) {
              this.selectStyleSheet.bind(this, newSheet, newLine, newCol);
          }
        }.bind(this);

        aEditor.addActionListener({
          onAttach: onAttach
        });
      } else {
        // If a line or column was specified we move the caret appropriately.
        aEditor.sourceEditor.setCaretPosition(line - 1, col - 1);
        this._styleSheetToSelect = null;
      }

        let summary = sheet ? this.getSummaryElementForEditor(aEditor)
                            : this._view.getSummaryElementByOrdinal(0);
        this._view.activeSummary = summary;
      this.selectedStyleSheetIndex = aEditor.styleSheetIndex;
    }.bind(this);

    if (!this.editors.length) {
      // We are in the main initialization phase so we wait for the editor
      // containing the target stylesheet to be added and select the target
      // stylesheet, optionally moving the cursor to a selected line.
      let self = this;
      this.addChromeListener({
        onEditorAdded: function SEC_selectSheet_onEditorAdded(aChrome, aEditor) {
          let sheet = self._styleSheetToSelect.sheet;
          if ((sheet && aEditor.styleSheet == sheet) ||
              (aEditor.styleSheetIndex == 0 && sheet == null)) {
            aChrome.removeChromeListener(this);
            aEditor.addActionListener(self);
            select(aEditor);
          }
        }
      });
    } else if (aSheet) {
      // We are already initialized and a stylesheet has been specified. Here
      // we iterate through the editors and select the one containing the target
      // stylesheet, optionally moving the cursor to a selected line.
      for each (let editor in this.editors) {
        if (editor.styleSheet == aSheet) {
          select(editor);
          break;
        }
      }
    }
  },

  resetEditors: function() {
    this._root.classList.remove("loading");
    for (let sheet of this._debuggee.styleSheets) {
      this._addStyleSheetEditor(sheet);
    }
  },

  _onStyleSheetAdded: function(event, sheet) {
    // this might be the first stylesheet, so remove loading indicator
    this._root.classList.remove("loading");
    this._addStyleSheetEditor(sheet);
  },

  _addStyleSheetEditor: function(sheet) {
    let editor = new StyleSheetEditor(sheet, this._window);
    editor.once("source-load", this._sourceLoaded.bind(this, editor));
    editor.on("summary-changed", this._summaryChanged.bind(this, editor));
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
      onCreate: function onItemCreate(summary, details, data) {
        /*
        let editor = aData.editor;
        wire(aSummary, ".stylesheet-enabled", function onToggleEnabled(aEvent) {
          aEvent.stopPropagation();
          aEvent.target.blur();

          editor.enableStyleSheet(editor.styleSheet.disabled);
        });

        wire(aSummary, ".stylesheet-saveButton", function onSaveButton(aEvent) {
          aEvent.stopPropagation();
          aEvent.target.blur();

          editor.saveToFile(editor.savedFile);
        });
        */


        this._updateSummaryForEditor(editor, summary);

        summary.addEventListener("focus", function onSummaryFocus(event) {
          if (event.target == summary) {
            // autofocus the stylesheet name
            summary.querySelector(".stylesheet-name").focus();
          }
        }, false);

        /*
        // autofocus new stylesheets
        if (editor.hasFlag(StyleEditorFlags.NEW)) {
          this._view.activeSummary = aSummary;
        }
        */

      }.bind(this),

      onHide: function ASV_onItemShow(summary, details, data) {
        // data.editor.onHide();
      },

      onShow: function ASV_onItemShow(summary, details, data) {
        let editor = data.editor;
        if (!editor.sourceEditor) {
          // only initialize source editor when we switch to this view
          let inputElement = details.querySelector(".stylesheet-editor-input");
          editor.load(inputElement);
        }
      }
    });
  },

  _summaryChanged: function(editor) {
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
    let index = editor.styleSheet.styleSheetIndex;
    summary = summary || this._view.getSummaryElementByOrdinal(index);
    let ruleCount = editor.styleSheet.cssRules.length;

    this._view.setItemClassName(summary, editor.flags);

    let label = summary.querySelector(".stylesheet-name > label");
    label.setAttribute("value", editor.friendlyName);

    text(summary, ".stylesheet-title", editor.styleSheet.title || "");
    text(summary, ".stylesheet-rule-count",
      PluralForm.get(ruleCount, _("ruleCount.label")).replace("#1", ruleCount));
    // text(summary, ".stylesheet-error-message", editor.errorMessage);
  }
}

Cu.import("resource:///modules/source-editor.jsm");

function StyleSheetEditor(styleSheet, win) {
  EventEmitter.decorate(this);

  this._styleSheet = styleSheet;
  this._inputElement = null;
  this._sourceEditor = null;
  this._window = win;

  this._state = {   // state to use when inputElement attaches
    text: "",
    selection: {start: 0, end: 0},
    readOnly: false,
    topIndex: 0,              // the first visible line
  };

  this._onSourceLoad = this._onSourceLoad.bind(this);
  this._onSummaryChanged = this._onSummaryChanged.bind(this);

  this._styleSheet.on("summary-changed", this._onSummaryChanged);
}

StyleSheetEditor.prototype = {
  get sourceEditor() {
    return this._sourceEditor;
  },

  get styleSheet() {
    return this._styleSheet;
  },

  get friendlyName() {
    return this._styleSheet.friendlyName;
  },

  fetchSource: function() {
    this._styleSheet.once("source-load", this._onSourceLoad);
    this._styleSheet.fetchSource();
  },

  _onSourceLoad: function(event, source) {
    this._state.text = source;
    this.emit("source-load");
  },

  _onSummaryChanged: function(event) {
    this.emit("summary-changed");
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

      /*
      if (this._focusOnSourceEditorReady) {
        this._focusOnSourceEditorReady = false;
        sourceEditor.focus();
      }

      sourceEditor.setTopIndex(this._state.topIndex);
      sourceEditor.setSelection(this._state.selection.start,
                                this._state.selection.end);
      */
    }.bind(this));
  },

  /**
   * Queue a throttled task to update the live style sheet.
   *
   * @param boolean aImmediate
   *        Optional. If true the update is performed immediately.
   */
  updateStyleSheet: function SE_updateStyleSheet(aImmediate)
  {
    if (this._updateTask) {
      // cancel previous queued task not executed within throttle delay
      this._window.clearTimeout(this._updateTask);
    }

    if (aImmediate) {
      this._updateStyleSheet();
    } else {
      this._updateTask = this._window.setTimeout(this._updateStyleSheet.bind(this),
                                           UPDATE_STYLESHEET_THROTTLE_DELAY);
    }
  },

  /**
   * Update live style sheet according to modifications.
   */
  _updateStyleSheet: function SE__updateStyleSheet()
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
  }
}
