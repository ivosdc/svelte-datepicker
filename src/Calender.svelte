<script>
    import {getDateRows, uuid, noop} from "./date-time.js";
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher();

    export let date;
    export let month;
    export let year;
    export let isAllowed;

    const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    let cells;

    const onChange = date => {
        dispatch("datechange", new Date(Date.UTC(year, month, date)));
    };

    const allow = (year, month, date) => {
        if (!date) return true;
        return isAllowed(new Date(year, month, date));
    };

    $: cells = getDateRows(month, year).map(c => ({
        value: c,
        allowed: allow(year, month, c)
    }));

</script>
<main>
    <div class="container">
        <div class="row">
            {#each weekdays as day}
                <div class="cell weekday">{day}</div>
            {/each}
        </div>

        <div class="row">
            {#each cells as {allowed, value} (uuid())}
                <div
                        on:click={allowed && value ? onChange.bind(this, value) : noop}
                        class:cell={true}
                        class:highlight={allowed && value}
                        class:disabled={!allowed}
                        class:selected={new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() === new Date(year, month, value).getTime()}>
                    {value || ''}
                </div>
            {/each}
        </div>
    </div>
</main>

<style>
    main {
        text-align: center;
    }

    .container {
        margin-top: 0.4em;
        width: 204px;
        background-color: #ededed;
    }

    .row {
        text-align: center;
        display: flex;
        font-size: 1em;
        font-weight: 300;
        padding: 0.4em 0.3em;
        flex-wrap: wrap;
        background-color: #dedede;
    }

    .cell {
        display: inline-block;
        width: 1.8em;
        height: 1.2em;
        text-align: center;
        font-size: 0.9em;
        padding: 0.2em;
        margin: 0.1em 0.1em 0.2em;
        background-color: #ffffff;
    }

    .weekday {
        color: #9a9a9a;
        font-weight: 300;
        background-color: whitesmoke;
    }

    .selected {
        background-color: lightsteelblue;
        color: black;
        font-weight: 200;
        text-shadow: 0 0 0.5em white;
    }

    .highlight {
        transition: transform 0.2s cubic-bezier(0.165, 0.84, 0.44, 1);
    }

    .disabled {
        background: #efefef;
        cursor: not-allowed;
        color: #bfbfbf;
    }

    .highlight:hover {
        color: black;
        background-color: white;
        opacity: 70%;
        font-weight: 400;
        cursor: pointer;
    }

    .selected.highlight:hover {
        background: cornflowerblue;
    }
</style>
