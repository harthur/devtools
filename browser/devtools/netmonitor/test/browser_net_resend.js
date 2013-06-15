/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let gPanelWin;
let gPanelDoc;

const ADD_QUERY = "t1=t2";
const ADD_HEADER = "Test-header: true";
const ADD_POSTDATA = "t3=t4";

/**
 * Tests if resending a requests works
 */
function test() {
  initNetMonitor(POST_DATA_URL).then(([aTab, aDebuggee, aMonitor]) => {
    info("Starting test... ");

    gPanelWin = aMonitor.panelWin;
    gPanelDoc = gPanelWin.document;

    let { L10N, SourceEditor, NetMonitorView } = gPanelWin;
    let { RequestsMenu, NetworkDetails } = NetMonitorView;

    RequestsMenu.lazyUpdate = false;

    waitForNetworkEvents(aMonitor, 0, 2).then(() => {
      let origItem = RequestsMenu.getItemAtIndex(0);
      RequestsMenu.selectedItem = origItem;

      // add a new custom request cloned from selected request
      RequestsMenu.cloneRequest();

      testCustomForm(origItem.attachment);

      // edit the custom request
      editCustomForm(() => {
        waitForNetworkEvents(aMonitor, 0, 1).then(() => {
          testSentRequest(RequestsMenu.selectedItem, origItem);
          finishUp(aMonitor);
        });
        // send the new request
        RequestsMenu.sendRequest();
      });
    });

    aDebuggee.performRequests();
  });
}

/*
 * Test that the New Request form was populated correctly
 */
function testCustomForm(aData) {
  is(gPanelDoc.getElementById("custom-method-value").value, aData.method,
     "new request form showing correct method");

  is(gPanelDoc.getElementById("custom-url-value").value, aData.url,
     "new request form showing correct url");

  let query = gPanelDoc.getElementById("custom-query-value");
  is(query.value, "foo=bar\nbaz=42\ntype=urlencoded",
     "new request form showing correct query string");

  let headers = gPanelDoc.getElementById("custom-headers-value").value.split("\n");
  for (let {name, value} of aData.requestHeaders.headers) {
    ok(headers.indexOf(name + ": " + value) >= 0, "form contains header from request");
  }

  let postData = gPanelDoc.getElementById("custom-postdata-value");
  is(postData.value, aData.requestPostData.postData.text,
     "new request form showing correct post data");
}

/*
 * Add some params and headers to the request form
 */
function editCustomForm(callback) {
  gPanelWin.focus();

  let query = gPanelDoc.getElementById("custom-query-value");
  query.addEventListener("focus", function onFocus() {
    query.removeEventListener("focus", onFocus, false);

    // add params to url query string field
    type(["VK_RETURN"]);
    type(ADD_QUERY);

    let headers = gPanelDoc.getElementById("custom-headers-value");
    headers.addEventListener("focus", function onFocus() {
      headers.removeEventListener("focus", onFocus, false);

      // add a header
      type(["VK_RETURN"]);
      type(ADD_HEADER);

      let postData = gPanelDoc.getElementById("custom-postdata-value");
      postData.addEventListener("focus", function onFocus() {
        postData.removeEventListener("focus", onFocus, false);

        // add to POST data
        type(ADD_POSTDATA);
        callback();
      }, false);
      postData.focus();
    }, false);
    headers.focus();
  }, false);
  query.focus();
}

/*
 * Make sure newly created event matches expected request
 */
function testSentRequest(aItem, aOrigItem) {
  let data = aItem.attachment;
  let origData = aOrigItem.attachment;

  is(data.method, origData.method, "correct method in sent request");

  is(data.url, origData.url + "&" + ADD_QUERY, "correct url in sent request");

  let hasHeader = data.requestHeaders.headers.some((header) => {
    return (header.name + ": " + header.value) == ADD_HEADER;
  })
  ok(hasHeader, "new header added to sent request");

  is(data.requestPostData.postData.text,
     origData.requestPostData.postData.text + ADD_POSTDATA,
     "post data added to sent request");
}


function type(aString) {
  for (let ch of aString) {
    EventUtils.synthesizeKey(ch, {}, gPanelWin);
  }
}

function finishUp(aMonitor) {
  gPanelWin = null;
  gPanelDoc = null;

  teardown(aMonitor).then(finish);
}