<svelte:options tag={'date-picker'}/>
<script>
    import {createEventDispatcher} from "svelte";
    import Calender from "./Calender.svelte";
    import {getMonthName} from "./date-time.js";

    const dispatch = createEventDispatcher();

    // props
    export let isAllowed = () => true;
    export let selected = new Date();

    // state
    let date, month, year, showDatePicker;

    // so that these change with props
    $: {
        date = selected.getUTCDate();
        month = selected.getUTCMonth();
        year = selected.getUTCFullYear();
    }

    // handlers
    const onFocus = () => {
        showDatePicker = true;
    };

    const next = () => {
        if (month === 11) {
            month = 0;
            year = year + 1;
            return;
        }
        month = month + 1;
    };

    const prev = () => {
        if (month === 0) {
            month = 11;
            year -= 1;
            return;
        }
        month -= 1;
    };

    const onDateChange = d => {
        showDatePicker = false;
        dispatch("datechange", d.detail);
    };

    const convertSelected = () => {
        const options = {weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit'};

        return selected.toLocaleDateString("de-DE", options);
    }

    let site = document.getElementsByTagName('html');
    site[0].addEventListener('click', (e) => {
        showDatePicker = false;
    });

</script>

<div id="datepicker" class="relative" on:click={(e) => {e.stopPropagation();}}>
    {#if showDatePicker}
        <div class="box">
            <div class="month-name">
                <div class="center">
                    <button type=text on:click={prev}>Prev</button>
                </div>
                <div class="center">{getMonthName(month)} {year}</div>
                <div class="center">
                    <button type=text on:click={next}>Next</button>
                </div>
            </div>
            <Calender
                    {month}
                    {year}
                    date={selected}
                    {isAllowed}
                    on:datechange={onDateChange}/>
        </div>
    {/if}
    <input type="text" size="14" on:focus={onFocus} value={convertSelected(selected)}/>
</div>

<style>
    .relative {
        position: relative;
        z-index: 1000;
    }

    .box {
        position: absolute;
        top: -120px;
        left: 40px;
        border: 1px solid lightsteelblue;
        display: inline-block;
        opacity: 100%;
        font-size: 0.95em;
        font-weight: 200;
        background-color: #efefef;
    }

    .month-name {
        display: flex;
        justify-content: space-around;
        align-items: center;
        margin: 0.2em 0;
    }

    .center {
        display: flex;
        justify-content: center;
        align-items: center;
        border: none;
        outline: none;
        font-size: 0.95em;
        font-weight: 200;
        padding-top: 0.4em;
        height: 1em;
    }

    button {
        outline: none;
        border: none;
        color: #999999;
        background-color: inherit;
        font-size: 0.85em;
        font-weight: 200;
        height: 1.3em;
        cursor: pointer;
    }

    button:hover {
        background-color: #ffffff;
    }

    input {
        outline: none;
        border: 1px solid #999999;
        color: #999999;
        background-color: inherit;
        font-size: 0.85em;
        font-weight: 200;
        height: 1.3em;
        border-radius: 3px;
        cursor: pointer;
    }
</style>
