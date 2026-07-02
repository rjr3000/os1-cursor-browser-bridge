/**
 * os1 Design Kit — injected into IDE browser pages for mockup iteration.
 * Duplicate DOM nodes (e.g. Odoo app tiles), add image containers, drag to reposition.
 */
(function () {
    if (window.__os1Design && window.__os1Design.__version) {
        return;
    }

    var VERSION = '1.0.0';
    var registry = {};
    var seq = 0;
    var dragState = null;
    var enabled = false;

    var STYLE_ID = 'os1-design-kit-styles';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            '[data-os1-design-id]{outline:2px dashed rgba(255,102,0,0.85);outline-offset:2px}',
            '[data-os1-design-id][data-os1-dragging]{outline-color:#0066ff;cursor:grabbing!important;opacity:0.92}',
            '.os1-design-container{box-sizing:border-box;background:#fff;border:2px dashed #ccc;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.12)}',
            '.os1-design-container img{display:block;width:100%;height:auto;object-fit:cover}',
            '.os1-design-container .os1-design-label{padding:8px 12px;font:600 13px/1.3 system-ui,sans-serif;color:#333;background:#f6f6f6}',
            '.os1-design-float{cursor:grab!important;touch-action:none}',
            '.os1-design-banner{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483646;background:#ff6600;color:#fff;font:600 12px system-ui;padding:6px 14px;border-radius:999px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.2)}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }

    function nextId() {
        seq += 1;
        return 'os1-d-' + seq + '-' + Date.now().toString(36);
    }

    function register(el, meta) {
        var id = nextId();
        el.setAttribute('data-os1-design-id', id);
        el.setAttribute('data-os1-design-draggable', '1');
        registry[id] = {
            id: id,
            tag: el.tagName,
            meta: meta || {},
            createdAt: Date.now(),
        };
        return id;
    }

    function resolveDomPath(pathStr) {
        if (!pathStr || typeof pathStr !== 'string') return null;
        var trimmed = pathStr.trim();
        try {
            var el = document.querySelector(trimmed);
            if (el) return el;
        } catch (_) { /* not a valid selector */ }
        var parts = trimmed.split(/\s*>\s*/);
        var current = document.body;
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            if (!part) continue;
            var nth = 0;
            var m = part.match(/^(.+)\[(\d+)\]$/);
            if (m) {
                part = m[1];
                nth = parseInt(m[2], 10);
            }
            if (i === 0 && (part === 'body' || part === 'html')) {
                current = part === 'html' ? document.documentElement : document.body;
                continue;
            }
            var candidates = current.querySelectorAll(part);
            if (!candidates.length) return null;
            current = nth ? candidates[nth] : candidates[0];
            if (!current) return null;
        }
        return current && current.nodeType === 1 ? current : null;
    }

    function resolveTarget(spec) {
        if (!spec) return null;
        if (typeof spec === 'string') {
            try { return document.querySelector(spec); } catch (_) { return resolveDomPath(spec); }
        }
        if (spec.id) return document.getElementById(spec.id);
        if (spec.selector) {
            try { return document.querySelector(spec.selector); } catch (_) { return null; }
        }
        if (spec.cursorElementId) {
            return document.querySelector('[data-cursor-element-id="' + spec.cursorElementId + '"]');
        }
        if (spec.ref) {
            return document.querySelector('[data-cursor-ref="' + spec.ref + '"]');
        }
        if (spec.domPath) return resolveDomPath(spec.domPath);
        return null;
    }

    function scrubIds(root) {
        var nodes = root.querySelectorAll ? root.querySelectorAll('[id]') : [];
        if (root.id) root.id = root.id + '-os1-copy-' + seq;
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].id = nodes[i].id + '-os1-copy-' + seq;
        }
    }

    function neutralizeLinks(root) {
        var links = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            a.setAttribute('data-os1-original-href', a.getAttribute('href') || '');
            a.setAttribute('href', '#');
            a.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
            });
        }
        if (root.tagName === 'A' && root.getAttribute('href')) {
            root.setAttribute('data-os1-original-href', root.getAttribute('href'));
            root.setAttribute('href', '#');
        }
    }

    function rectOf(el) {
        var r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
    }

    function makeFloatAt(el, rect) {
        el.classList.add('os1-design-float');
        el.style.position = 'fixed';
        el.style.zIndex = String(2147483000 + seq);
        el.style.margin = '0';
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        el.style.width = rect.width + 'px';
        if (rect.height > 0) el.style.height = rect.height + 'px';
    }

    function onPointerDown(e) {
        if (!enabled) return;
        var t = e.target.closest('[data-os1-design-draggable="1"]');
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        var r = rectOf(t);
        dragState = {
            el: t,
            id: t.getAttribute('data-os1-design-id'),
            startX: e.clientX,
            startY: e.clientY,
            origLeft: r.left,
            origTop: r.top,
        };
        if (t.style.position !== 'fixed') {
            makeFloatAt(t, r);
            dragState.origLeft = r.left;
            dragState.origTop = r.top;
        } else {
            dragState.origLeft = parseFloat(t.style.left) || r.left;
            dragState.origTop = parseFloat(t.style.top) || r.top;
        }
        t.setAttribute('data-os1-dragging', '1');
    }

    function onPointerMove(e) {
        if (!dragState) return;
        e.preventDefault();
        var dx = e.clientX - dragState.startX;
        var dy = e.clientY - dragState.startY;
        dragState.el.style.left = (dragState.origLeft + dx) + 'px';
        dragState.el.style.top = (dragState.origTop + dy) + 'px';
    }

    function onPointerUp() {
        if (!dragState) return;
        dragState.el.removeAttribute('data-os1-dragging');
        var id = dragState.id;
        var pos = {
            left: parseFloat(dragState.el.style.left) || 0,
            top: parseFloat(dragState.el.style.top) || 0,
        };
        if (registry[id]) registry[id].position = pos;
        dragState = null;
    }

    function bindDrag() {
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerUp, true);
    }

    function showBanner() {
        var existing = document.querySelector('.os1-design-banner');
        if (existing) return;
        var b = document.createElement('div');
        b.className = 'os1-design-banner';
        b.textContent = 'os1 mockup mode — drag orange-outlined elements';
        document.body.appendChild(b);
    }

    function hideBanner() {
        var b = document.querySelector('.os1-design-banner');
        if (b) b.remove();
    }

    window.__os1Design = {
        __version: VERSION,

        enable: function () {
            injectStyles();
            if (!enabled) bindDrag();
            enabled = true;
            showBanner();
            return { success: true, enabled: true, version: VERSION };
        },

        disable: function () {
            enabled = false;
            hideBanner();
            return { success: true, enabled: false };
        },

        duplicate: function (spec, opts) {
            opts = opts || {};
            if (!enabled) this.enable();
            var el = resolveTarget(spec);
            if (!el) return { success: false, error: 'target not found', spec: spec };

            var cloneRoot;
            if (opts.cloneWrapper !== false) {
                cloneRoot = el.closest('.col-3, .col-md-2, .col-md-3, .col-lg-2, [class*="col-"]') || el.parentElement || el;
            } else {
                cloneRoot = el;
            }

            var clone = cloneRoot.cloneNode(true);
            scrubIds(clone);
            neutralizeLinks(clone);

            if (opts.label) {
                var labelEl = clone.querySelector('.o_app, [role="option"], .o_menuitem') || clone;
                if (labelEl.textContent !== undefined) labelEl.textContent = opts.label;
            }

            var insertParent = cloneRoot.parentNode;
            var insertBefore = cloneRoot.nextSibling;

            var id = register(clone, { type: 'duplicate', source: spec, label: opts.label });

            if (opts.float !== false) {
                var rect = rectOf(cloneRoot);
                insertParent.insertBefore(clone, insertBefore);
                makeFloatAt(clone, rect);
                if (opts.offsetX || opts.offsetY) {
                    clone.style.left = (rect.left + (opts.offsetX || 20)) + 'px';
                    clone.style.top = (rect.top + (opts.offsetY || 20)) + 'px';
                }
            } else {
                insertParent.insertBefore(clone, insertBefore);
            }

            return {
                success: true,
                id: id,
                tag: clone.tagName,
                rect: rectOf(clone),
                message: 'Duplicated — drag the orange-outlined copy',
            };
        },

        addContainer: function (opts) {
            opts = opts || {};
            if (!enabled) this.enable();

            var parent = opts.parentSelector
                ? document.querySelector(opts.parentSelector)
                : (document.querySelector('.o_home_menu, .o_action_manager, main, .container') || document.body);

            if (!parent) return { success: false, error: 'parent not found' };

            var w = opts.width || 320;
            var h = opts.height || 200;
            var box = document.createElement('div');
            box.className = 'os1-design-container os1-design-float';

            if (opts.imageUrl) {
                var img = document.createElement('img');
                img.src = opts.imageUrl;
                img.alt = opts.label || 'Mockup';
                if (h) img.style.maxHeight = h + 'px';
                box.appendChild(img);
            } else {
                box.style.minHeight = h + 'px';
                box.style.background = opts.background || 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)';
            }

            if (opts.label) {
                var cap = document.createElement('div');
                cap.className = 'os1-design-label';
                cap.textContent = opts.label;
                box.appendChild(cap);
            }

            box.style.width = w + 'px';
            parent.appendChild(box);

            var id = register(box, { type: 'container', opts: opts });
            var rect = {
                left: opts.left != null ? opts.left : Math.max(16, (window.innerWidth - w) / 2),
                top: opts.top != null ? opts.top : 120,
                width: w,
                height: h,
            };
            makeFloatAt(box, rect);

            return { success: true, id: id, rect: rectOf(box), message: 'Container added — drag to reposition' };
        },

        list: function () {
            var items = [];
            var nodes = document.querySelectorAll('[data-os1-design-id]');
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                var id = n.getAttribute('data-os1-design-id');
                items.push({
                    id: id,
                    tag: n.tagName,
                    text: (n.textContent || '').trim().slice(0, 80),
                    rect: rectOf(n),
                    meta: registry[id] ? registry[id].meta : {},
                });
            }
            return { success: true, count: items.length, items: items };
        },

        remove: function (id) {
            var el = document.querySelector('[data-os1-design-id="' + id + '"]');
            if (!el) return { success: false, error: 'not found', id: id };
            el.remove();
            delete registry[id];
            return { success: true, id: id };
        },

        move: function (id, left, top) {
            var el = document.querySelector('[data-os1-design-id="' + id + '"]');
            if (!el) return { success: false, error: 'not found', id: id };
            if (el.style.position !== 'fixed') makeFloatAt(el, rectOf(el));
            el.style.left = left + 'px';
            el.style.top = top + 'px';
            if (registry[id]) registry[id].position = { left: left, top: top };
            return { success: true, id: id, rect: rectOf(el) };
        },
    };
})();
