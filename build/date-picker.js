var DatePicker = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }
    function attribute_to_object(attributes) {
        const result = {};
        for (const attribute of attributes) {
            result[attribute.name] = attribute.value;
        }
        return result;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    let SvelteElement;
    if (typeof HTMLElement === 'function') {
        SvelteElement = class extends HTMLElement {
            constructor() {
                super();
                this.attachShadow({ mode: 'open' });
            }
            connectedCallback() {
                const { on_mount } = this.$$;
                this.$$.on_disconnect = on_mount.map(run).filter(is_function);
                // @ts-ignore todo: improve typings
                for (const key in this.$$.slotted) {
                    // @ts-ignore todo: improve typings
                    this.appendChild(this.$$.slotted[key]);
                }
            }
            attributeChangedCallback(attr, _oldValue, newValue) {
                this[attr] = newValue;
            }
            disconnectedCallback() {
                run_all(this.$$.on_disconnect);
            }
            $destroy() {
                destroy_component(this, 1);
                this.$destroy = noop;
            }
            $on(type, callback) {
                // TODO should this delegate to addEventListener?
                const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
                callbacks.push(callback);
                return () => {
                    const index = callbacks.indexOf(callback);
                    if (index !== -1)
                        callbacks.splice(index, 1);
                };
            }
            $set($$props) {
                if (this.$$set && !is_empty($$props)) {
                    this.$$.skip_bound = true;
                    this.$$set($$props);
                    this.$$.skip_bound = false;
                }
            }
        };
    }

    let locales = 'en-EN';

    function setLocales(locale) {
        locales = locale;
    }

    const monthNames = [
        getMonthLong('1.1.1970'),
        getMonthLong('2.1.1970'),
        getMonthLong('3.1.1970'),
        getMonthLong('4.1.1970'),
        getMonthLong('5.1.1970'),
        getMonthLong('6.1.1970'),
        getMonthLong('7.1.1970'),
        getMonthLong('8.1.1970'),
        getMonthLong('9.1.1970'),
        getMonthLong('10.1.1970'),
        getMonthLong('11.1.1970'),
        getMonthLong('12.1.1970')
    ];

    const weekdays = [getWeekdayShort('1.4.1970'),
        getWeekdayShort('1.5.1970'),
        getWeekdayShort('1.6.1970'),
        getWeekdayShort('1.7.1970'),
        getWeekdayShort('1.8.1970'),
        getWeekdayShort('1.9.1970'),
        getWeekdayShort('1.10.1970')];

    function getDateRows(monthIndex, year) {
        const {days} = getMonthStats(monthIndex, year);
        const rows = getEmptyRows();
        const startIndex = new Date(year, monthIndex, 1).getDay();
        Array.from({length: days}).forEach((_, i) => {
            const index = startIndex + i;
            rows[index] = i + 1;
        });
        const filled = rows.map(i => (Array.isArray(i) ? undefined : i));

        return filled[35] ? filled : filled.slice(0, -7);
    }

    const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    const isLeapYear = year => year % 4 === 0;

    function getEmptyRows() {
        return Array.from({length: 42}).map(() => []);
    }

    function getMonthLong(time) {
        return new Date(time).toLocaleDateString(locales, {
            month: 'long'
        })
    }

    function getWeekdayShort(time) {
        return new Date(time).toLocaleDateString(locales, {
            weekday: 'short'
        }).substr(0,2);
    }

    function getMonthDays(index, year) {
        return index !== 1 ? monthDays[index] : isLeapYear(year) ? 29 : 28;
    }

    function getMonthStats(monthIndex, year) {
        const today = new Date(year, monthIndex, 1);
        const index = today.getMonth();
        return {
            name: index[index],
            days: getMonthDays(index, year)
        };
    }

    const iconLeft =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-arrow-left"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';

    const iconRight =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-arrow-right"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';

    /* src/DatePicker.svelte generated by Svelte v3.35.0 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[17] = list[i].allowed;
    	child_ctx[18] = list[i].value;
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[21] = list[i];
    	return child_ctx;
    }

    // (87:4) {#if showDatePicker}
    function create_if_block(ctx) {
    	let div7;
    	let div3;
    	let div0;
    	let button0;
    	let t0;
    	let div1;
    	let t1_value = monthNames[/*month*/ ctx[1]] + "";
    	let t1;
    	let t2;
    	let t3;
    	let t4;
    	let div2;
    	let button1;
    	let t5;
    	let div6;
    	let div4;
    	let t6;
    	let div5;
    	let mounted;
    	let dispose;
    	let each_value_1 = weekdays;
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	let each_value = /*cells*/ ctx[4];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			div7 = element("div");
    			div3 = element("div");
    			div0 = element("div");
    			button0 = element("button");
    			t0 = space();
    			div1 = element("div");
    			t1 = text(t1_value);
    			t2 = space();
    			t3 = text(/*year*/ ctx[2]);
    			t4 = space();
    			div2 = element("div");
    			button1 = element("button");
    			t5 = space();
    			div6 = element("div");
    			div4 = element("div");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t6 = space();
    			div5 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(button0, "type", "text");
    			attr(div1, "class", "center");
    			attr(button1, "type", "text");
    			attr(div3, "class", "month-name");
    			attr(div4, "class", "row");
    			attr(div5, "class", "row");
    			attr(div6, "class", "container");
    			attr(div7, "class", "box");
    		},
    		m(target, anchor) {
    			insert(target, div7, anchor);
    			append(div7, div3);
    			append(div3, div0);
    			append(div0, button0);
    			button0.innerHTML = iconLeft;
    			append(div3, t0);
    			append(div3, div1);
    			append(div1, t1);
    			append(div1, t2);
    			append(div1, t3);
    			append(div3, t4);
    			append(div3, div2);
    			append(div2, button1);
    			button1.innerHTML = iconRight;
    			append(div7, t5);
    			append(div7, div6);
    			append(div6, div4);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(div4, null);
    			}

    			append(div6, t6);
    			append(div6, div5);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div5, null);
    			}

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*prev*/ ctx[7]),
    					listen(button1, "click", /*next*/ ctx[6])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*month*/ 2 && t1_value !== (t1_value = monthNames[/*month*/ ctx[1]] + "")) set_data(t1, t1_value);
    			if (dirty & /*year*/ 4) set_data(t3, /*year*/ ctx[2]);

    			if (dirty & /*weekdays*/ 0) {
    				each_value_1 = weekdays;
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(div4, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*cells, selected, Date, year, month, onChange*/ 535) {
    				each_value = /*cells*/ ctx[4];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div5, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div7);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (101:20) {#each weekdays as day}
    function create_each_block_1(ctx) {
    	let div;
    	let t_value = /*day*/ ctx[21] + "";
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(t_value);
    			attr(div, "class", "cell weekday");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (107:20) {#each cells as {allowed, value}}
    function create_each_block(ctx) {
    	let div;
    	let t0_value = (/*value*/ ctx[18] || "") + "";
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			toggle_class(div, "cell", true);
    			toggle_class(div, "highlight", /*allowed*/ ctx[17] && /*value*/ ctx[18]);
    			toggle_class(div, "disabled", !/*allowed*/ ctx[17]);
    			toggle_class(div, "selected", /*selected*/ ctx[0] === new Date(/*year*/ ctx[2], /*month*/ ctx[1], /*value*/ ctx[18]));
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);

    			if (!mounted) {
    				dispose = listen(div, "click", function () {
    					if (is_function(/*allowed*/ ctx[17] && /*value*/ ctx[18]
    					? /*onChange*/ ctx[9].bind(this, /*value*/ ctx[18])
    					: click_handler)) (/*allowed*/ ctx[17] && /*value*/ ctx[18]
    					? /*onChange*/ ctx[9].bind(this, /*value*/ ctx[18])
    					: click_handler).apply(this, arguments);
    				});

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*cells*/ 16 && t0_value !== (t0_value = (/*value*/ ctx[18] || "") + "")) set_data(t0, t0_value);

    			if (dirty & /*cells*/ 16) {
    				toggle_class(div, "highlight", /*allowed*/ ctx[17] && /*value*/ ctx[18]);
    			}

    			if (dirty & /*cells*/ 16) {
    				toggle_class(div, "disabled", !/*allowed*/ ctx[17]);
    			}

    			if (dirty & /*selected, Date, year, month, cells*/ 23) {
    				toggle_class(div, "selected", /*selected*/ ctx[0] === new Date(/*year*/ ctx[2], /*month*/ ctx[1], /*value*/ ctx[18]));
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div;
    	let t;
    	let input;
    	let input_value_value;
    	let mounted;
    	let dispose;
    	let if_block = /*showDatePicker*/ ctx[3] && create_if_block(ctx);

    	return {
    		c() {
    			div = element("div");
    			if (if_block) if_block.c();
    			t = space();
    			input = element("input");
    			this.c = noop;
    			attr(input, "type", "text");
    			attr(input, "size", "14");
    			input.value = input_value_value = /*convertSelected*/ ctx[8](/*selected*/ ctx[0]);
    			attr(div, "id", "datepicker");
    			attr(div, "class", "relative");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			if (if_block) if_block.m(div, null);
    			append(div, t);
    			append(div, input);

    			if (!mounted) {
    				dispose = [
    					listen(input, "focus", /*onFocus*/ ctx[5]),
    					listen(div, "click", click_handler_1)
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*showDatePicker*/ ctx[3]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div, t);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*selected*/ 1 && input_value_value !== (input_value_value = /*convertSelected*/ ctx[8](/*selected*/ ctx[0])) && input.value !== input_value_value) {
    				input.value = input_value_value;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const click_handler = () => {
    	
    };

    const click_handler_1 = e => {
    	e.stopPropagation();
    };

    function instance($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	let { selected = new Date() } = $$props;

    	let { isallowed = date => {
    		return date.getTime() <= dateNow();
    	} } = $$props;

    	let { locale = "en-EN" } = $$props;
    	let date, month, year, showDatePicker;

    	let dateNow = () => {
    		let now = new Date();
    		return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
    	};

    	const onFocus = () => {
    		$$invalidate(3, showDatePicker = true);
    	};

    	const next = () => {
    		if (month === 11) {
    			$$invalidate(1, month = 0);
    			$$invalidate(2, year = year + 1);
    			return;
    		}

    		$$invalidate(1, month = month + 1);
    	};

    	const prev = () => {
    		if (month === 0) {
    			$$invalidate(1, month = 11);
    			$$invalidate(2, year -= 1);
    			return;
    		}

    		$$invalidate(1, month -= 1);
    	};

    	const convertSelected = date => {
    		const options = {
    			weekday: "short",
    			year: "numeric",
    			month: "2-digit",
    			day: "2-digit"
    		};

    		return date.toLocaleDateString(locale, options);
    	};

    	let site = document.getElementsByTagName("html");

    	site[0].addEventListener("click", e => {
    		$$invalidate(3, showDatePicker = false);
    	});

    	let cells;

    	const onChange = date => {
    		$$invalidate(3, showDatePicker = false);
    		$$invalidate(0, selected = new Date(Date.UTC(year, month, date)));
    		let selectedDay = selected.getTime();
    		dispatch("datechange", { selectedDay });
    	};

    	const allow = (year, month, date) => {
    		if (!date) return true;
    		return isallowed(new Date(year, month, date));
    	};

    	$$self.$$set = $$props => {
    		if ("selected" in $$props) $$invalidate(0, selected = $$props.selected);
    		if ("isallowed" in $$props) $$invalidate(11, isallowed = $$props.isallowed);
    		if ("locale" in $$props) $$invalidate(10, locale = $$props.locale);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*selected*/ 1) {
    			 $$invalidate(0, selected = typeof selected === "string"
    			? new Date(parseInt(selected))
    			: selected);
    		}

    		if ($$self.$$.dirty & /*selected*/ 1) {
    			 {
    				date = selected.getUTCDate();
    				$$invalidate(1, month = selected.getUTCMonth());
    				$$invalidate(2, year = selected.getUTCFullYear());
    			}
    		}

    		if ($$self.$$.dirty & /*month, year*/ 6) {
    			 $$invalidate(4, cells = getDateRows(month, year).map(c => ({ value: c, allowed: allow(year, month, c) })));
    		}
    	};

    	 $$invalidate(10, locale = locale => {
    		setLocales(locale);
    		return locale;
    	});

    	return [
    		selected,
    		month,
    		year,
    		showDatePicker,
    		cells,
    		onFocus,
    		next,
    		prev,
    		convertSelected,
    		onChange,
    		locale,
    		isallowed
    	];
    }

    class DatePicker extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>input{outline:none;border:1px solid #999999;background-color:inherit;font-weight:300;cursor:pointer}.relative{position:relative}.box{position:fixed;border:1px solid #004666;display:inline-block;font-weight:100;background-color:#004666;color:#ffffff;z-index:10000;font-size:inherit;padding:0;margin:0}.center{display:flex;justify-content:center;align-items:center;width:100%}button{outline:none;border:none;background-color:white;cursor:pointer;justify-content:center;align-items:center;margin:3px 8px;padding:3px 3px 0}button:hover{background-color:#4A849F;color:white}.container{background-color:#dedede}.row{text-align:center;display:grid;grid-template-columns:auto auto auto auto auto auto auto;font-weight:100;padding:0.3em;flex-wrap:wrap}.cell{display:flex;justify-content:center;align-items:center;margin:3px;padding:3px;background-color:#ededed}.weekday{color:#9a9a9a;font-weight:300;background-color:whitesmoke}.month-name{display:flex;justify-content:space-around;align-items:center;padding:4px 0;font-weight:200}.selected{background-color:#4A849F;font-weight:200;color:white;text-shadow:0 0 0.5em white}.highlight{background-color:white;color:grey}.disabled{background-color:#9d9d9d;cursor:not-allowed}.highlight:hover{background-color:#004666;color:white;cursor:pointer}.selected.highlight:hover{background:#004666}</style>`;

    		init(
    			this,
    			{
    				target: this.shadowRoot,
    				props: attribute_to_object(this.attributes),
    				customElement: true
    			},
    			instance,
    			create_fragment,
    			safe_not_equal,
    			{ selected: 0, isallowed: 11, locale: 10 }
    		);

    		if (options) {
    			if (options.target) {
    				insert(options.target, this, options.anchor);
    			}

    			if (options.props) {
    				this.$set(options.props);
    				flush();
    			}
    		}
    	}

    	static get observedAttributes() {
    		return ["selected", "isallowed", "locale"];
    	}

    	get selected() {
    		return this.$$.ctx[0];
    	}

    	set selected(selected) {
    		this.$set({ selected });
    		flush();
    	}

    	get isallowed() {
    		return this.$$.ctx[11];
    	}

    	set isallowed(isallowed) {
    		this.$set({ isallowed });
    		flush();
    	}

    	get locale() {
    		return this.$$.ctx[10];
    	}

    	set locale(locale) {
    		this.$set({ locale });
    		flush();
    	}
    }

    customElements.define("date-picker", DatePicker);

    return DatePicker;

}());
