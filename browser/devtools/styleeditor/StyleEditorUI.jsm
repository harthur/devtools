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
  this._editors = [];
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

    for (let styleSheet of this._debuggee.styleSheets) {
      this._addSheetEditor(styleSheet);
    }
  },

  _addSheetEditor: function(styleSheet) {
    let editor = new StyleSheetEditor(styleSheet);
    this._editors.push(editor);

    // add new sidebar item and editor to the UI
    this._view.appendTemplatedItem(STYLE_EDITOR_TEMPLATE, {
      data: {
        editor: editor
      },
      disableAnimations: this._alwaysDisableAnimations,
      ordinal: editor.styleSheetIndex,
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

        this._updateSummaryForEditor(editor, aSummary);
        */

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
        editor.onShow();
      }
    });
  },

  /**
   * Retrieve the summary element for a given editor.
   *
   * @param StyleEditor aEditor
   * @return DOMElement
   *         Item's summary element or null if not found.
   * @see SplitView
   */
  getSummaryElementForEditor: function SEC_getSummaryElementForEditor(aEditor)
  {
    return this._view.getSummaryElementByOrdinal(aEditor.styleSheetIndex);
  },

  /**
   * Update split view summary of given StyleEditor instance.
   *
   * @param StyleEditor aEditor
   * @param DOMElement aSummary
   *        Optional item's summary element to update. If none, item corresponding
   *        to passed aEditor is used.
   */
  _updateSummaryForEditor: function SEUI_updateSummaryForEditor(editor, summary)
  {
    let summary = summary || this.getSummaryElementForEditor(editor);
    let ruleCount = editor.styleSheet.cssRules.length;

    this._view.setItemClassName(summary, editor.flags);

    let label = summary.querySelector(".stylesheet-name > label");
    label.setAttribute("value", editor.getFriendlyName());

    text(summary, ".stylesheet-title", editor.styleSheet.title || "");
    text(summary, ".stylesheet-rule-count",
      PluralForm.get(ruleCount, _("ruleCount.label")).replace("#1", ruleCount));
    // text(summary, ".stylesheet-error-message", editor.errorMessage);
  }
}

Cu.import("resource:///modules/source-editor.jsm");

function StyleSheetEditor(styleSheet, inputElement) {
  this._styleSheet = styleSheet;
  this._inputElement = inputElement;
  this._sourceEditor = null;
}

StyleSheetEditor.prototype = {
  get sourceEditor() {
    return this._sourceEditor;
  },

  get styleSheet() {
    return this._styleSheet;
  },

  load: function(inputElement) {
    this._inputElement = inputElement;

    let sourceEditor = new SourceEditor();
    let config = {
      initialText: this._styleSheet.text,
      showLineNumbers: true,
      mode: SourceEditor.MODES.CSS /*
      readOnly: this._state.readOnly,
      keys: this._getKeyBindings() */
    };

    sourceEditor.init(inputElement, config, function onSourceEditorReady() {
      /*
      setupBracketCompletion(sourceEditor);

      sourceEditor.addEventListener(SourceEditor.EVENTS.TEXT_CHANGED,
                                    function onTextChanged(aEvent) {
        this.updateStyleSheet();
      }.bind(this));
      */

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
  }
}
