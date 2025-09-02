(function () {
  const bodyElement = document.body;
  const shieldElement = document.getElementById('screenshot-shield');
  let hideTimerId = null;
  const strictToggle = document.getElementById('strict-toggle');
  const metaProtect = document.querySelector('meta[name="screenshot-protect"]');

  let isStrictMode = false;
  let isKeyHoldToView = false;
  let isMouseHoldToView = false;
  const HOLD_KEY = 'v';
  let extensionDetected = false;
  let isProtectionActive = false;

  function showShield() {
    if (!shieldElement) return;
    bodyElement.classList.add('shielded');
    isProtectionActive = true;
  }

  function hideShield() {
    bodyElement.classList.remove('shielded');
    isProtectionActive = false;
  }

  function flashShield(durationMs = 2500) {
    showShield();
    if (hideTimerId) clearTimeout(hideTimerId);
    hideTimerId = setTimeout(hideShield, durationMs);
  }

  function applyStrictState() {
    if (isStrictMode) {
      if (isKeyHoldToView || isMouseHoldToView) {
        hideShield();
      } else {
        showShield();
      }
    }
  }

  function onKeyDown(e) {
    const key = e.key;
    const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';

    // Print shortcuts (Ctrl/Cmd + P)
    const isPrintShortcut = (e.ctrlKey || e.metaKey) && lowerKey === 'p';

    // Windows PrintScreen key
    const isPrintScreen = key === 'PrintScreen' || e.keyCode === 44;

    // Common macOS screenshot shortcuts: Cmd+Shift+3/4/5/6
    const isMacScreenshotCombo = e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(key);

    if (lowerKey === HOLD_KEY && isStrictMode) {
      isKeyHoldToView = true;
      applyStrictState();
      return;
    }

    if (isPrintShortcut) {
      // Prevent default print dialog (we'll still trigger print but content is hidden)
      e.preventDefault();
      showShield();
      // Trigger print shortly after; print stylesheet keeps output blank
      setTimeout(() => window.print(), 60);
      return;
    }

    if (isPrintScreen || isMacScreenshotCombo) {
      flashShield(3000);
    }
  }

  function onKeyUp(e) {
    const lowerKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (lowerKey === HOLD_KEY && isStrictMode) {
      isKeyHoldToView = false;
      applyStrictState();
    }
  }

  function onVisibilityChange() {
    // When tab becomes hidden (e.g., OS screenshot UI overlays), engage shield
    if (document.hidden) {
      flashShield(4000);
    }
  }

  function onWindowBlur() {
    // Extra heuristic: if window loses focus briefly, flash the shield
    flashShield(2000);
  }

  // Print lifecycle events
  window.addEventListener('beforeprint', showShield);
  window.addEventListener('afterprint', hideShield);

  // Input and focus heuristics
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);

  // Mouse hold-to-view for strict mode
  window.addEventListener('mousedown', function () {
    if (!isStrictMode) return;
    isMouseHoldToView = true;
    applyStrictState();
  });
  window.addEventListener('mouseup', function () {
    if (!isStrictMode) return;
    isMouseHoldToView = false;
    applyStrictState();
  });

  // Initialize strict mode from meta or toggle
  function initStrictMode() {
    const metaContent = metaProtect && (metaProtect.getAttribute('content') || '').toLowerCase();
    const metaWantsStrict = !!(metaContent && metaContent.includes('strict'));
    isStrictMode = metaWantsStrict;
    if (strictToggle) {
      strictToggle.checked = isStrictMode;
      strictToggle.addEventListener('change', function () {
        isStrictMode = !!strictToggle.checked;
        applyStrictState();
      });
    }
    applyStrictState();
  }

  // Enhanced canvas fingerprinting detection for screenshot tools
  function detectCanvasCapture() {
    // Monitor for external canvas reading attempts
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      console.warn('Canvas toDataURL detected - possible screenshot attempt');
      flashShield(3000);
      return 'data:image/png;base64,'; // Return blank image
    };
    
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      console.warn('Canvas getImageData detected - possible screenshot attempt');
      flashShield(3000);
      // Return blank image data
      const [sx, sy, sw, sh] = args;
      const imageData = originalGetImageData.apply(this, args);
      // Fill with white pixels
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255;     // Red
        imageData.data[i + 1] = 255; // Green
        imageData.data[i + 2] = 255; // Blue
        imageData.data[i + 3] = 255; // Alpha
      }
      return imageData;
    };
  }

  // Detect DOM manipulation by extensions
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Check for suspicious additions that might be from screenshot extensions
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node;
              // Common patterns used by screenshot extensions
              if (element.className && (
                element.className.includes('screenshot') ||
                element.className.includes('capture') ||
                element.className.includes('lightshot') ||
                element.className.includes('gyazo') ||
                element.className.includes('snagit') ||
                element.className.includes('nimbus') ||
                element.className.includes('fireshot')
              )) {
                extensionDetected = true;
                flashShield(5000);
                console.warn('Screenshot extension detected:', element.className);
              }
              
              // Check for suspicious IDs
              if (element.id && (
                element.id.includes('screenshot') ||
                element.id.includes('capture') ||
                element.id.includes('overlay')
              )) {
                extensionDetected = true;
                flashShield(5000);
                console.warn('Screenshot extension detected by ID:', element.id);
              }
            }
          });
        }
      });
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'data-*']
    });
  }

  // Aggressive timing-based protection
  function setupTimingProtection() {
    // Monitor for suspicious frame rate drops (might indicate screen capture)
    let lastTime = performance.now();
    let frameCount = 0;
    
    function checkFrameRate() {
      const now = performance.now();
      frameCount++;
      
      if (now - lastTime > 1000) { // Check every second
        const fps = frameCount;
        frameCount = 0;
        lastTime = now;
        
        // If FPS drops significantly, might indicate screen recording
        if (fps < 25 && !document.hidden) {
          console.warn('Low FPS detected - possible screen recording');
          flashShield(2000);
        }
      }
      
      requestAnimationFrame(checkFrameRate);
    }
    
    requestAnimationFrame(checkFrameRate);
    
    // Random shield flashes to disrupt automated capture
    setInterval(() => {
      if (!isProtectionActive && !isStrictMode && Math.random() < 0.05) {
        flashShield(100); // Very brief flash
      }
    }, 2000);
  }

  // Monitor for external script injection
  function monitorScriptInjection() {
    const originalAppendChild = Node.prototype.appendChild;
    const originalInsertBefore = Node.prototype.insertBefore;
    
    Node.prototype.appendChild = function(child) {
      if (child.tagName === 'SCRIPT' && child.src && 
          !child.src.includes(location.hostname) && 
          !child.src.startsWith('data:')) {
        console.warn('External script injection detected:', child.src);
        flashShield(3000);
      }
      return originalAppendChild.call(this, child);
    };
    
    Node.prototype.insertBefore = function(newNode, referenceNode) {
      if (newNode.tagName === 'SCRIPT' && newNode.src && 
          !newNode.src.includes(location.hostname) &&
          !newNode.src.startsWith('data:')) {
        console.warn('External script injection detected:', newNode.src);
        flashShield(3000);
      }
      return originalInsertBefore.call(this, newNode, referenceNode);
    };
  }

  // Monitor for clipboard access (some extensions use this)
  function monitorClipboardAccess() {
    const originalWriteText = navigator.clipboard?.writeText;
    const originalReadText = navigator.clipboard?.readText;
    
    if (originalWriteText) {
      navigator.clipboard.writeText = function(...args) {
        console.warn('Clipboard write detected - possible screenshot extension');
        flashShield(1500);
        return originalWriteText.apply(this, args);
      };
    }
    
    if (originalReadText) {
      navigator.clipboard.readText = function(...args) {
        console.warn('Clipboard read detected - possible screenshot extension');
        flashShield(1500);
        return originalReadText.apply(this, args);
      };
    }
  }

  // Initialize all protection mechanisms
  function initAdvancedProtection() {
    detectCanvasCapture();
    setupMutationObserver();
    setupTimingProtection();
    monitorScriptInjection();
    monitorClipboardAccess();
    
    // Additional DevTools detection
    let devtools = {
      open: false,
      orientation: null
    };
    
    setInterval(() => {
      if (window.outerHeight - window.innerHeight > 200 || 
          window.outerWidth - window.innerWidth > 200) {
        if (!devtools.open) {
          devtools.open = true;
          console.warn('DevTools detected - possible screenshot attempt');
          flashShield(3000);
        }
      } else {
        devtools.open = false;
      }
    }, 500);
  }

  // Disable right-click context menu
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    flashShield(1000);
    return false;
  });

  // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
  document.addEventListener('keydown', function(e) {
    // F12
    if (e.keyCode === 123) {
      e.preventDefault();
      flashShield(2000);
      return false;
    }
    // Ctrl+Shift+I (DevTools)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
      e.preventDefault();
      flashShield(2000);
      return false;
    }
    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
      e.preventDefault();
      flashShield(2000);
      return false;
    }
    // Ctrl+U (View Source)
    if (e.ctrlKey && e.keyCode === 85) {
      e.preventDefault();
      flashShield(2000);
      return false;
    }
    // Ctrl+S (Save As)
    if (e.ctrlKey && e.keyCode === 83) {
      e.preventDefault();
      flashShield(2000);
      return false;
    }
  });

  // Detect if running in iframe (some screenshot tools use this)
  if (window !== window.top) {
    console.warn('Running in iframe - possible screenshot tool');
    showShield();
  }

  // Monitor for window resize (screenshot tools often resize)
  let resizeTimeout;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      console.warn('Window resize detected - possible screenshot tool');
      flashShield(1500);
    }, 100);
  });

  // Detect headless browsers (used by some automated screenshot tools)
  function detectHeadless() {
    // Check for common headless browser indicators
    if (navigator.webdriver || 
        window.navigator.webdriver ||
        window.callPhantom || 
        window._phantom ||
        window.__nightmare ||
        window.Buffer) {
      console.warn('Headless browser detected');
      showShield();
      return true;
    }
    
    // Check for missing features that headless browsers often lack
    if (!window.chrome && navigator.userAgent.includes('Chrome')) {
      console.warn('Possible headless Chrome detected');
      flashShield(3000);
    }
    
    return false;
  }

  initStrictMode();
  initAdvancedProtection();
  detectHeadless();
})();


