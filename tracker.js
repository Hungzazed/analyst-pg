(function bootstrapAnalystTracker(window, document) {
  'use strict';

  var STORAGE_KEYS = {
    sessionId: 'analyst_tracker_session_id',
    sessionUpdatedAt: 'analyst_tracker_session_updated_at',
    userId: 'analyst_tracker_user_id'
  };

  var DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
  var DEFAULT_ENDPOINT = '/metrics/events';

  var trackerConfig = {
    apiKey: '',
    endpoint: DEFAULT_ENDPOINT,
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    autoTrackPageview: true,
    autoTrackClicks: false,
    defaultMetadata: {},
    context: {}
  };

  var clickHandlerAttached = false;

  function getStorage() {
    try {
      return window.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function generateId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '_' + window.crypto.randomUUID();
    }

    var random = Math.random().toString(36).slice(2);
    return prefix + '_' + Date.now().toString(36) + random;
  }

  function getNow() {
    return Date.now();
  }

  function readStoredSession() {
    var storage = getStorage();
    if (!storage) {
      return null;
    }

    var sessionId = storage.getItem(STORAGE_KEYS.sessionId);
    var updatedAtRaw = storage.getItem(STORAGE_KEYS.sessionUpdatedAt);
    var updatedAt = updatedAtRaw ? Number(updatedAtRaw) : 0;

    if (!sessionId || !updatedAt || Number.isNaN(updatedAt)) {
      return null;
    }

    return {
      sessionId: sessionId,
      updatedAt: updatedAt
    };
  }

  function saveSession(sessionId) {
    var storage = getStorage();
    if (!storage) {
      return;
    }

    storage.setItem(STORAGE_KEYS.sessionId, sessionId);
    storage.setItem(STORAGE_KEYS.sessionUpdatedAt, String(getNow()));
  }

  function getOrCreateSessionId() {
    var stored = readStoredSession();
    var now = getNow();

    if (stored && now - stored.updatedAt <= trackerConfig.sessionTtlMs) {
      saveSession(stored.sessionId);
      return stored.sessionId;
    }

    var newSessionId = generateId('sess');
    saveSession(newSessionId);
    return newSessionId;
  }

  function setStoredUserId(userId) {
    var storage = getStorage();
    if (!storage) {
      return;
    }

    if (!userId) {
      storage.removeItem(STORAGE_KEYS.userId);
      return;
    }

    storage.setItem(STORAGE_KEYS.userId, String(userId));
  }

  function getStoredUserId() {
    var storage = getStorage();
    if (!storage) {
      return undefined;
    }

    var userId = storage.getItem(STORAGE_KEYS.userId);
    return userId || undefined;
  }

  function sanitizeUrl(value) {
    if (!value) {
      return undefined;
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    return undefined;
  }

  function parseUserAgent(userAgent) {
    var ua = (userAgent || '').toLowerCase();

    var browser = 'Unknown';
    if (ua.indexOf('edg/') >= 0) {
      browser = 'Edge';
    } else if (ua.indexOf('opr/') >= 0 || ua.indexOf('opera') >= 0) {
      browser = 'Opera';
    } else if (ua.indexOf('chrome/') >= 0) {
      browser = 'Chrome';
    } else if (ua.indexOf('safari/') >= 0 && ua.indexOf('chrome/') < 0) {
      browser = 'Safari';
    } else if (ua.indexOf('firefox/') >= 0) {
      browser = 'Firefox';
    }

    var os = 'Unknown';
    if (ua.indexOf('windows') >= 0) {
      os = 'Windows';
    } else if (ua.indexOf('mac os') >= 0 || ua.indexOf('macintosh') >= 0) {
      os = 'macOS';
    } else if (ua.indexOf('android') >= 0) {
      os = 'Android';
    } else if (ua.indexOf('iphone') >= 0 || ua.indexOf('ipad') >= 0 || ua.indexOf('ios') >= 0) {
      os = 'iOS';
    } else if (ua.indexOf('linux') >= 0) {
      os = 'Linux';
    }

    var device = 'desktop';
    if (ua.indexOf('mobile') >= 0 || ua.indexOf('iphone') >= 0 || ua.indexOf('android') >= 0) {
      device = 'mobile';
    } else if (ua.indexOf('ipad') >= 0 || ua.indexOf('tablet') >= 0) {
      device = 'tablet';
    }

    return {
      browser: browser,
      os: os,
      device: device
    };
  }

  function buildPayload(type, partial) {
    var ua = window.navigator.userAgent || '';
    var detected = parseUserAgent(ua);
    var sessionId = getOrCreateSessionId();

    var payload = {
      eventId: generateId('evt'),
      type: type,
      timestamp: getNow(),
      sessionId: sessionId,
      userId: getStoredUserId(),
      url: sanitizeUrl(window.location.href),
      title: document.title || undefined,
      referrer: sanitizeUrl(document.referrer),
      userAgent: ua,
      device: detected.device,
      browser: detected.browser,
      os: detected.os,
      metadata: {}
    };

    if (trackerConfig.defaultMetadata && typeof trackerConfig.defaultMetadata === 'object') {
      payload.metadata = Object.assign({}, trackerConfig.defaultMetadata);
    }

    if (trackerConfig.context && typeof trackerConfig.context === 'object') {
      payload = Object.assign(payload, trackerConfig.context);
    }

    if (partial && typeof partial === 'object') {
      payload = Object.assign(payload, partial);
    }

    if (payload.metadata && typeof payload.metadata === 'object') {
      payload.metadata = Object.assign({}, trackerConfig.defaultMetadata || {}, partial && partial.metadata ? partial.metadata : {});
    }

    if (payload.type === 'PAGEVIEW' && !sanitizeUrl(payload.url)) {
      payload.url = sanitizeUrl(window.location.href);
    }

    return payload;
  }

  function sendEvent(payload) {
    if (!trackerConfig.apiKey) {
      return Promise.reject(new Error('AnalystTracker: apiKey is required. Call AnalystTracker.init({ apiKey }) first.'));
    }

    var body = JSON.stringify(payload);
    var headers = {
      'Content-Type': 'application/json',
      'x-api-key': trackerConfig.apiKey
    };

    if (typeof window.fetch === 'function') {
      return window
        .fetch(trackerConfig.endpoint, {
          method: 'POST',
          headers: headers,
          body: body,
          keepalive: true,
          credentials: 'omit'
        })
        .then(function (res) {
          if (!res.ok) {
            throw new Error('AnalystTracker: failed with status ' + res.status);
          }
          return res;
        });
    }

    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      var accepted = navigator.sendBeacon(trackerConfig.endpoint, blob);
      if (accepted) {
        return Promise.resolve();
      }
    }

    return Promise.reject(new Error('AnalystTracker: fetch/sendBeacon is not available'));
  }

  function track(type, partialPayload) {
    var payload = buildPayload(type, partialPayload);
    return sendEvent(payload).catch(function () {
      return undefined;
    });
  }

  function attachClickTracking() {
    if (clickHandlerAttached) {
      return;
    }

    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') {
        return;
      }

      var clickable = target.closest('a,button,[data-track-click]');
      if (!clickable) {
        return;
      }

      var tag = (clickable.tagName || '').toLowerCase();
      var text = (clickable.textContent || '').trim().slice(0, 120);
      var id = clickable.id || undefined;
      var href = clickable.getAttribute && clickable.getAttribute('href');

      track('CLICK', {
        title: document.title || undefined,
        url: sanitizeUrl(window.location.href),
        metadata: {
          tag: tag,
          text: text || undefined,
          id: id,
          href: sanitizeUrl(href || undefined)
        }
      });
    });

    clickHandlerAttached = true;
  }

  function patchSpaNavigation() {
    if (!window.history || !window.history.pushState) {
      return;
    }

    var originalPushState = window.history.pushState;
    var originalReplaceState = window.history.replaceState;

    function trackPageviewAfterNavigation() {
      setTimeout(function () {
        track('PAGEVIEW');
      }, 0);
    }

    window.history.pushState = function () {
      originalPushState.apply(window.history, arguments);
      trackPageviewAfterNavigation();
    };

    window.history.replaceState = function () {
      originalReplaceState.apply(window.history, arguments);
      trackPageviewAfterNavigation();
    };

    window.addEventListener('popstate', trackPageviewAfterNavigation);
  }

  var AnalystTracker = {
    init: function init(options) {
      var config = options || {};
      trackerConfig.apiKey = String(config.apiKey || '').trim();
      trackerConfig.endpoint = config.endpoint || DEFAULT_ENDPOINT;
      trackerConfig.sessionTtlMs = Number(config.sessionTtlMs || DEFAULT_SESSION_TTL_MS);
      trackerConfig.autoTrackPageview = config.autoTrackPageview !== false;
      trackerConfig.autoTrackClicks = config.autoTrackClicks === true;
      trackerConfig.defaultMetadata = config.defaultMetadata || {};
      trackerConfig.context = config.context || {};

      if (trackerConfig.autoTrackPageview) {
        track('PAGEVIEW');
        patchSpaNavigation();
      }

      if (trackerConfig.autoTrackClicks) {
        attachClickTracking();
      }

      return this;
    },

    setUser: function setUser(userId) {
      setStoredUserId(userId ? String(userId) : '');
      return this;
    },

    clearUser: function clearUser() {
      setStoredUserId('');
      return this;
    },

    setContext: function setContext(context) {
      trackerConfig.context = Object.assign({}, trackerConfig.context, context || {});
      return this;
    },

    trackPageview: function trackPageview(metadata) {
      return track('PAGEVIEW', { metadata: metadata || {} });
    },

    trackClick: function trackClick(metadata) {
      return track('CLICK', { metadata: metadata || {} });
    },

    trackCustom: function trackCustom(name, metadata) {
      return track('CUSTOM', {
        title: name ? String(name) : undefined,
        metadata: metadata || {}
      });
    },

    track: function trackAny(type, payload) {
      return track(type, payload || {});
    }
  };

  // Auto-initialize from script tag data attributes
  function autoInitializeFromScriptTag() {
    try {
      var scripts = document.querySelectorAll('script[data-key]');
      if (scripts.length === 0) {
        return;
      }

      // Get the last script tag with data-key attribute (this script)
      var scriptTag = scripts[scripts.length - 1];
      var apiKey = scriptTag.getAttribute('data-key');
      var endpoint = scriptTag.getAttribute('data-endpoint') || DEFAULT_ENDPOINT;
      var autoPageview = scriptTag.getAttribute('data-auto-pageview') !== 'false';
      var autoClicks = scriptTag.getAttribute('data-auto-clicks') !== 'false';

      if (!apiKey) {
        console.warn('AnalystTracker: data-key attribute is required');
        return;
      }

      AnalystTracker.init({
        apiKey: apiKey,
        endpoint: endpoint,
        autoTrackPageview: autoPageview,
        autoTrackClicks: autoClicks
      });
    } catch (error) {
      console.error('AnalystTracker: auto-initialization failed', error);
    }
  }

  window.AnalystTracker = AnalystTracker;

  // Trigger auto-initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitializeFromScriptTag);
  } else {
    autoInitializeFromScriptTag();
  }
})(window, document);
