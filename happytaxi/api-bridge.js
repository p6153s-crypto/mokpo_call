/* ============================================================
   행복콜택시 통합관리시스템 - API Bridge (v2, CORS 우회 방식)
   ------------------------------------------------------------
   ⚠️ 중요: Google Apps Script는 응답에 CORS 허용 헤더를 넣는 공식
   방법을 제공하지 않습니다. 그래서 일반 fetch()로 외부 도메인에서
   호출하면 브라우저가 응답을 읽지 못하게 막습니다(요청 자체는
   서버에서 성공 처리되어도 마찬가지입니다).

   이 브릿지는 CORS 검사 자체가 적용되지 않는 두 가지 방식을 씁니다.
     1) 일반 조회/저장  → JSONP (<script> 태그로 GET 요청)
     2) 대용량 데이터(파일 업로드) → 숨겨진 <form> POST + <iframe> +
        postMessage 로 결과 전달

   화면 코드(Index.html/Admin.html)는 여전히 google.script.run.함수명()
   형태를 그대로 사용하면 되고, 이 파일이 내부적으로 알아서
   JSONP/폼 방식 중 알맞은 쪽으로 변환해서 호출합니다.

   사용법
   ------
     <script>window.HCAB_API_URL = "https://script.google.com/macros/s/AKfycb.../exec";</script>
     <script src="api-bridge.js"></script>
   ============================================================ */
(function (global) {
  'use strict';

  var API_URL = global.HCAB_API_URL;
  if (!API_URL) {
    console.error(
      '[api-bridge] HCAB_API_URL이 설정되지 않았습니다. ' +
      'api-bridge.js를 불러오기 전에 window.HCAB_API_URL을 지정하세요.'
    );
  }

  // 이 함수들은 데이터 용량이 클 수 있어(base64 파일 등) JSONP(GET) 대신
  // 폼 POST + iframe 방식으로 처리합니다. 필요시 이 목록에 함수명을 추가하세요.
  var LARGE_PAYLOAD_FNS = { uploadFiles: true };

  var REQUEST_TIMEOUT_MS = 30000;

  function assign(base, extra) {
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (var k2 in extra) if (Object.prototype.hasOwnProperty.call(extra, k2)) out[k2] = extra[k2];
    return out;
  }

  function finish(handlers, data) {
    if (data && data.error) {
      if (handlers.failure) handlers.failure({ message: data.error });
      else console.error('[api-bridge] 서버 오류:', data.error);
    } else {
      if (handlers.success) handlers.success(data ? data.result : undefined, handlers.userObject);
    }
  }

  function fail(handlers, message) {
    if (handlers.failure) handlers.failure({ message: message });
    else console.error('[api-bridge]', message);
  }

  // ── 방식 1: JSONP (일반 조회/저장) ──────────────────────
  var jsonpSeq = 0;
  function callJsonp(fnName, args, handlers) {
    var cbName = '__gasCb' + (++jsonpSeq) + '_' + Date.now();
    var script = document.createElement('script');
    var done = false;

    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      cleanup();
      fail(handlers, '요청 시간이 초과되었습니다. 네트워크 상태를 확인해주세요.');
    }, REQUEST_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      try { delete global[cbName]; } catch (e) { global[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    global[cbName] = function (data) {
      if (done) return;
      done = true;
      cleanup();
      finish(handlers, data);
    };

    script.onerror = function () {
      if (done) return;
      done = true;
      cleanup();
      fail(handlers, '네트워크 오류로 요청에 실패했습니다.');
    };

    var sep = API_URL.indexOf('?') >= 0 ? '&' : '?';
    script.src = API_URL + sep +
      'fn=' + encodeURIComponent(fnName) +
      '&args=' + encodeURIComponent(JSON.stringify(args)) +
      '&callback=' + cbName;

    document.body.appendChild(script);
  }

  // ── 방식 2: 폼 POST + iframe + postMessage (대용량 데이터) ──
  var pendingForms = {};
  var formSeq = 0;
  var listenerAttached = false;

  function attachMessageListener() {
    if (listenerAttached) return;
    listenerAttached = true;
    global.addEventListener('message', function (ev) {
      var data = ev.data;
      if (!data || data.__gasBridge !== true || !data.reqId) return;
      var entry = pendingForms[data.reqId];
      if (!entry) return;
      delete pendingForms[data.reqId];
      clearTimeout(entry.timer);
      if (entry.iframe && entry.iframe.parentNode) entry.iframe.parentNode.removeChild(entry.iframe);
      finish(entry.handlers, { result: data.result, error: data.error });
    });
  }

  function callForm(fnName, args, handlers) {
    attachMessageListener();
    var reqId = 'req' + (++formSeq) + '_' + Date.now();
    var iframeName = 'gasBridgeFrame_' + reqId;

    var iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    var form = document.createElement('form');
    form.method = 'POST';
    form.action = API_URL;
    form.target = iframeName;
    form.style.display = 'none';

    function addField(name, value) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    addField('fn', fnName);
    addField('args', JSON.stringify(args));
    addField('reqId', reqId);
    addField('parentOrigin', global.location.origin);

    document.body.appendChild(form);

    var timer = setTimeout(function () {
      if (!pendingForms[reqId]) return;
      delete pendingForms[reqId];
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      fail(handlers, '요청 시간이 초과되었습니다. 파일 용량이 너무 크지 않은지 확인해주세요.');
    }, REQUEST_TIMEOUT_MS * 3); // 파일 업로드는 시간이 더 걸릴 수 있어 여유있게 설정

    pendingForms[reqId] = { handlers: handlers, iframe: iframe, timer: timer };

    form.submit();
    setTimeout(function () { if (form.parentNode) form.parentNode.removeChild(form); }, 0);
  }

  function callServer(fnName, args, handlers) {
    if (LARGE_PAYLOAD_FNS[fnName]) callForm(fnName, args, handlers);
    else callJsonp(fnName, args, handlers);
  }

  // ── google.script.run 과 동일한 인터페이스로 감싸기 ──────
  function createRunner(handlers) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) { return createRunner(assign(handlers, { success: cb })); };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) { return createRunner(assign(handlers, { failure: cb })); };
        }
        if (prop === 'withUserObject') {
          return function (obj) { return createRunner(assign(handlers, { userObject: obj })); };
        }
        return function () {
          var args = Array.prototype.slice.call(arguments);
          callServer(String(prop), args, handlers);
        };
      }
    });
  }

  global.google = global.google || {};
  global.google.script = global.google.script || {};
  global.google.script.run = createRunner({});
})(window);
