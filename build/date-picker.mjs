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

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
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
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function destroy_block(block, lookup) {
        block.d(1);
        lookup.delete(block.key);
    }
    function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
        let o = old_blocks.length;
        let n = list.length;
        let i = o;
        const old_indexes = {};
        while (i--)
            old_indexes[old_blocks[i].key] = i;
        const new_blocks = [];
        const new_lookup = new Map();
        const deltas = new Map();
        i = n;
        while (i--) {
            const child_ctx = get_context(ctx, list, i);
            const key = get_key(child_ctx);
            let block = lookup.get(key);
            if (!block) {
                block = create_each_block(key, child_ctx);
                block.c();
            }
            else if (dynamic) {
                block.p(child_ctx, dirty);
            }
            new_lookup.set(key, new_blocks[i] = block);
            if (key in old_indexes)
                deltas.set(key, Math.abs(i - old_indexes[key]));
        }
        const will_move = new Set();
        const did_move = new Set();
        function insert(block) {
            transition_in(block, 1);
            block.m(node, next);
            lookup.set(block.key, block);
            next = block.first;
            n--;
        }
        while (o && n) {
            const new_block = new_blocks[n - 1];
            const old_block = old_blocks[o - 1];
            const new_key = new_block.key;
            const old_key = old_block.key;
            if (new_block === old_block) {
                // do nothing
                next = new_block.first;
                o--;
                n--;
            }
            else if (!new_lookup.has(old_key)) {
                // remove old block
                destroy(old_block, lookup);
                o--;
            }
            else if (!lookup.has(new_key) || will_move.has(new_key)) {
                insert(new_block);
            }
            else if (did_move.has(old_key)) {
                o--;
            }
            else if (deltas.get(new_key) > deltas.get(old_key)) {
                did_move.add(new_key);
                insert(new_block);
            }
            else {
                will_move.add(old_key);
                o--;
            }
        }
        while (o--) {
            const old_block = old_blocks[o];
            if (!new_lookup.has(old_block.key))
                destroy(old_block, lookup);
        }
        while (n)
            insert(new_blocks[n - 1]);
        return new_blocks;
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
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
        const prop_values = options.props || {};
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
            ? instance(component, prop_values, (i, ret, ...rest) => {
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
            mount_component(component, options.target, options.anchor);
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
                // @ts-ignore todo: improve typings
                for (const key in this.$$.slotted) {
                    // @ts-ignore todo: improve typings
                    this.appendChild(this.$$.slotted[key]);
                }
            }
            attributeChangedCallback(attr, _oldValue, newValue) {
                this[attr] = newValue;
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

    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ];
    const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const isLeapYear = year => year % 4 === 0;
    const getEmptyRows = () => {
        return Array.from({length: 42}).map(() => []);
    };
    const getMonthDays = (index, year) => {
        return index !== 1 ? monthDays[index] : isLeapYear(year) ? 29 : 28;
    };

    const getMonthStats = (monthIndex, year) => {
        const today = new Date(year, monthIndex, 1);
        const index = today.getMonth();
        return {
            name: index[index],
            days: getMonthDays(index, year)
        };
    };

    const getMonthName = index => monthNames[index];

    const getDateRows = (monthIndex, year) => {
        const {days} = getMonthStats(monthIndex, year);
        const rows = getEmptyRows();
        const startIndex = new Date(year, monthIndex, 1).getDay();
        Array.from({length: days}).forEach((_, i) => {
            const index = startIndex + i;
            rows[index] = i + 1;
        });
        const filled = rows.map(i => (Array.isArray(i) ? undefined : i));

        return filled[35] ? filled : filled.slice(0, -7);
    };

    const noop$1 = () => {
    };

    const uuid = (() => {
        let id = 1;
        return () => {
            return ++id;
        };
    })();

    /* src/Calender.svelte generated by Svelte v3.24.1 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[9] = list[i].allowed;
    	child_ctx[10] = list[i].value;
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[13] = list[i];
    	return child_ctx;
    }

    // (33:12) {#each weekdays as day}
    function create_each_block_1(ctx) {
    	let div;
    	let t_value = /*day*/ ctx[13] + "";
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

    // (39:12) {#each cells as {allowed, value}
    function create_each_block(key_1, ctx) {
    	let div;
    	let t0_value = (/*value*/ ctx[10] || "") + "";
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	return {
    		key: key_1,
    		first: null,
    		c() {
    			div = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			toggle_class(div, "cell", true);
    			toggle_class(div, "highlight", /*allowed*/ ctx[9] && /*value*/ ctx[10]);
    			toggle_class(div, "disabled", !/*allowed*/ ctx[9]);
    			toggle_class(div, "selected", new Date(/*date*/ ctx[0].getFullYear(), /*date*/ ctx[0].getMonth(), /*date*/ ctx[0].getDate()).getTime() === new Date(/*year*/ ctx[2], /*month*/ ctx[1], /*value*/ ctx[10]).getTime());
    			this.first = div;
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);

    			if (!mounted) {
    				dispose = listen(div, "click", function () {
    					if (is_function(/*allowed*/ ctx[9] && /*value*/ ctx[10]
    					? /*onChange*/ ctx[5].bind(this, /*value*/ ctx[10])
    					: noop$1)) (/*allowed*/ ctx[9] && /*value*/ ctx[10]
    					? /*onChange*/ ctx[5].bind(this, /*value*/ ctx[10])
    					: noop$1).apply(this, arguments);
    				});

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*cells*/ 8 && t0_value !== (t0_value = (/*value*/ ctx[10] || "") + "")) set_data(t0, t0_value);

    			if (dirty & /*cells*/ 8) {
    				toggle_class(div, "highlight", /*allowed*/ ctx[9] && /*value*/ ctx[10]);
    			}

    			if (dirty & /*cells*/ 8) {
    				toggle_class(div, "disabled", !/*allowed*/ ctx[9]);
    			}

    			if (dirty & /*Date, date, year, month, cells*/ 15) {
    				toggle_class(div, "selected", new Date(/*date*/ ctx[0].getFullYear(), /*date*/ ctx[0].getMonth(), /*date*/ ctx[0].getDate()).getTime() === new Date(/*year*/ ctx[2], /*month*/ ctx[1], /*value*/ ctx[10]).getTime());
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
    	let main;
    	let div2;
    	let div0;
    	let t;
    	let div1;
    	let each_blocks = [];
    	let each1_lookup = new Map();
    	let each_value_1 = /*weekdays*/ ctx[4];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	let each_value = /*cells*/ ctx[3];
    	const get_key = ctx => uuid();

    	for (let i = 0; i < each_value.length; i += 1) {
    		let child_ctx = get_each_context(ctx, each_value, i);
    		let key = get_key();
    		each1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
    	}

    	return {
    		c() {
    			main = element("main");
    			div2 = element("div");
    			div0 = element("div");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t = space();
    			div1 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.c = noop;
    			attr(div0, "class", "row");
    			attr(div1, "class", "row");
    			attr(div2, "class", "container");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, div2);
    			append(div2, div0);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(div0, null);
    			}

    			append(div2, t);
    			append(div2, div1);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div1, null);
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*weekdays*/ 16) {
    				each_value_1 = /*weekdays*/ ctx[4];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(div0, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*cells, Date, date, year, month, onChange, noop*/ 47) {
    				const each_value = /*cells*/ ctx[3];
    				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each1_lookup, div1, destroy_block, create_each_block, null, get_each_context);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_each(each_blocks_1, detaching);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].d();
    			}
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	let { date } = $$props;
    	let { month } = $$props;
    	let { year } = $$props;
    	let { isAllowed } = $$props;
    	const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    	let cells;

    	const onChange = date => {
    		dispatch("datechange", new Date(Date.UTC(year, month, date)));
    	};

    	const allow = (year, month, date) => {
    		if (!date) return true;
    		return isAllowed(new Date(year, month, date));
    	};

    	$$self.$$set = $$props => {
    		if ("date" in $$props) $$invalidate(0, date = $$props.date);
    		if ("month" in $$props) $$invalidate(1, month = $$props.month);
    		if ("year" in $$props) $$invalidate(2, year = $$props.year);
    		if ("isAllowed" in $$props) $$invalidate(6, isAllowed = $$props.isAllowed);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*month, year*/ 6) {
    			 $$invalidate(3, cells = getDateRows(month, year).map(c => ({ value: c, allowed: allow(year, month, c) })));
    		}
    	};

    	return [date, month, year, cells, weekdays, onChange, isAllowed];
    }

    class Calender extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>main{text-align:center}.container{margin-top:0.4em;width:204px;background-color:#ededed}.row{text-align:center;display:flex;font-size:1em;font-weight:300;padding:0.4em 0.3em;flex-wrap:wrap;background-color:#dedede}.cell{display:inline-block;width:1.8em;height:1.2em;text-align:center;font-size:0.9em;padding:0.2em;margin:0.1em 0.1em 0.2em;background-color:#ffffff}.weekday{color:#9a9a9a;font-weight:300;background-color:whitesmoke}.selected{background-color:lightsteelblue;color:black;font-weight:200;text-shadow:0 0 0.5em white}.highlight{transition:transform 0.2s cubic-bezier(0.165, 0.84, 0.44, 1)}.disabled{background:#efefef;cursor:not-allowed;color:#bfbfbf}.highlight:hover{color:black;background-color:white;opacity:70%;font-weight:400;cursor:pointer}.selected.highlight:hover{background:cornflowerblue}</style>`;
    		init(this, { target: this.shadowRoot }, instance, create_fragment, safe_not_equal, { date: 0, month: 1, year: 2, isAllowed: 6 });

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
    		return ["date", "month", "year", "isAllowed"];
    	}

    	get date() {
    		return this.$$.ctx[0];
    	}

    	set date(date) {
    		this.$set({ date });
    		flush();
    	}

    	get month() {
    		return this.$$.ctx[1];
    	}

    	set month(month) {
    		this.$set({ month });
    		flush();
    	}

    	get year() {
    		return this.$$.ctx[2];
    	}

    	set year(year) {
    		this.$set({ year });
    		flush();
    	}

    	get isAllowed() {
    		return this.$$.ctx[6];
    	}

    	set isAllowed(isAllowed) {
    		this.$set({ isAllowed });
    		flush();
    	}
    }

    /* src/DatePicker.svelte generated by Svelte v3.24.1 */

    function create_if_block(ctx) {
    	let div4;
    	let div3;
    	let div0;
    	let button0;
    	let t1;
    	let div1;
    	let t2_value = getMonthName(/*month*/ ctx[2]) + "";
    	let t2;
    	let t3;
    	let t4;
    	let t5;
    	let div2;
    	let button1;
    	let t7;
    	let calender;
    	let current;
    	let mounted;
    	let dispose;

    	calender = new Calender({
    			props: {
    				month: /*month*/ ctx[2],
    				year: /*year*/ ctx[3],
    				date: /*selected*/ ctx[1],
    				isAllowed: /*isAllowed*/ ctx[0]
    			}
    		});

    	calender.$on("datechange", /*onDateChange*/ ctx[8]);

    	return {
    		c() {
    			div4 = element("div");
    			div3 = element("div");
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Prev";
    			t1 = space();
    			div1 = element("div");
    			t2 = text(t2_value);
    			t3 = space();
    			t4 = text(/*year*/ ctx[3]);
    			t5 = space();
    			div2 = element("div");
    			button1 = element("button");
    			button1.textContent = "Next";
    			t7 = space();
    			create_component(calender.$$.fragment);
    			attr(button0, "type", "text");
    			attr(div0, "class", "center");
    			attr(div1, "class", "center");
    			attr(button1, "type", "text");
    			attr(div2, "class", "center");
    			attr(div3, "class", "month-name");
    			attr(div4, "class", "box");
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div3);
    			append(div3, div0);
    			append(div0, button0);
    			append(div3, t1);
    			append(div3, div1);
    			append(div1, t2);
    			append(div1, t3);
    			append(div1, t4);
    			append(div3, t5);
    			append(div3, div2);
    			append(div2, button1);
    			append(div4, t7);
    			mount_component(calender, div4, null);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*prev*/ ctx[7]),
    					listen(button1, "click", /*next*/ ctx[6])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if ((!current || dirty & /*month*/ 4) && t2_value !== (t2_value = getMonthName(/*month*/ ctx[2]) + "")) set_data(t2, t2_value);
    			if (!current || dirty & /*year*/ 8) set_data(t4, /*year*/ ctx[3]);
    			const calender_changes = {};
    			if (dirty & /*month*/ 4) calender_changes.month = /*month*/ ctx[2];
    			if (dirty & /*year*/ 8) calender_changes.year = /*year*/ ctx[3];
    			if (dirty & /*selected*/ 2) calender_changes.date = /*selected*/ ctx[1];
    			if (dirty & /*isAllowed*/ 1) calender_changes.isAllowed = /*isAllowed*/ ctx[0];
    			calender.$set(calender_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(calender.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(calender.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div4);
    			destroy_component(calender);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let div;
    	let t;
    	let input;
    	let input_value_value;
    	let current;
    	let mounted;
    	let dispose;
    	let if_block = /*showDatePicker*/ ctx[4] && create_if_block(ctx);

    	return {
    		c() {
    			div = element("div");
    			if (if_block) if_block.c();
    			t = space();
    			input = element("input");
    			this.c = noop;
    			attr(input, "type", "text");
    			attr(input, "size", "14");
    			input.value = input_value_value = /*convertSelected*/ ctx[9](/*selected*/ ctx[1]);
    			attr(div, "id", "datepicker");
    			attr(div, "class", "relative");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			if (if_block) if_block.m(div, null);
    			append(div, t);
    			append(div, input);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(input, "focus", /*onFocus*/ ctx[5]),
    					listen(div, "click", click_handler)
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*showDatePicker*/ ctx[4]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*showDatePicker*/ 16) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, t);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			if (!current || dirty & /*selected*/ 2 && input_value_value !== (input_value_value = /*convertSelected*/ ctx[9](/*selected*/ ctx[1])) && input.value !== input_value_value) {
    				input.value = input_value_value;
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const click_handler = e => {
    	e.stopPropagation();
    };

    function instance$1($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	let { isAllowed = () => true } = $$props;
    	let { selected = new Date() } = $$props;

    	// state
    	let date, month, year, showDatePicker;

    	// handlers
    	const onFocus = () => {
    		$$invalidate(4, showDatePicker = true);
    	};

    	const next = () => {
    		if (month === 11) {
    			$$invalidate(2, month = 0);
    			$$invalidate(3, year = year + 1);
    			return;
    		}

    		$$invalidate(2, month = month + 1);
    	};

    	const prev = () => {
    		if (month === 0) {
    			$$invalidate(2, month = 11);
    			$$invalidate(3, year -= 1);
    			return;
    		}

    		$$invalidate(2, month -= 1);
    	};

    	const onDateChange = d => {
    		$$invalidate(4, showDatePicker = false);
    		dispatch("datechange", d.detail);
    	};

    	const convertSelected = () => {
    		const options = {
    			weekday: "short",
    			year: "numeric",
    			month: "2-digit",
    			day: "2-digit"
    		};

    		return selected.toLocaleDateString("de-DE", options);
    	};

    	let site = document.getElementsByTagName("html");

    	site[0].addEventListener("click", e => {
    		$$invalidate(4, showDatePicker = false);
    	});

    	$$self.$$set = $$props => {
    		if ("isAllowed" in $$props) $$invalidate(0, isAllowed = $$props.isAllowed);
    		if ("selected" in $$props) $$invalidate(1, selected = $$props.selected);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*selected*/ 2) {
    			// so that these change with props
    			 {
    				date = selected.getUTCDate();
    				$$invalidate(2, month = selected.getUTCMonth());
    				$$invalidate(3, year = selected.getUTCFullYear());
    			}
    		}
    	};

    	return [
    		isAllowed,
    		selected,
    		month,
    		year,
    		showDatePicker,
    		onFocus,
    		next,
    		prev,
    		onDateChange,
    		convertSelected
    	];
    }

    class DatePicker extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>.relative{position:relative;z-index:1000}.box{position:absolute;top:-120px;left:40px;border:1px solid lightsteelblue;display:inline-block;opacity:100%;font-size:0.95em;font-weight:200;background-color:#efefef}.month-name{display:flex;justify-content:space-around;align-items:center;margin:0.2em 0}.center{display:flex;justify-content:center;align-items:center;border:none;outline:none;font-size:0.95em;font-weight:200;padding-top:0.4em;height:1em}button{outline:none;border:none;color:#999999;background-color:inherit;font-size:0.85em;font-weight:200;height:1.3em;cursor:pointer}button:hover{background-color:#ffffff}input{outline:none;border:1px solid #999999;color:#999999;background-color:inherit;font-size:0.85em;font-weight:200;height:1.3em;border-radius:3px;cursor:pointer}</style>`;
    		init(this, { target: this.shadowRoot }, instance$1, create_fragment$1, safe_not_equal, { isAllowed: 0, selected: 1 });

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
    		return ["isAllowed", "selected"];
    	}

    	get isAllowed() {
    		return this.$$.ctx[0];
    	}

    	set isAllowed(isAllowed) {
    		this.$set({ isAllowed });
    		flush();
    	}

    	get selected() {
    		return this.$$.ctx[1];
    	}

    	set selected(selected) {
    		this.$set({ selected });
    		flush();
    	}
    }

    customElements.define("date-picker", DatePicker);

    return DatePicker;

}());
