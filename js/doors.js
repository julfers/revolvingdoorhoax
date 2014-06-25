;(function () {
    'use strict';
    /*
    Use Skulpt to convert the doors Python module API for use in the browser. Beware that this this
    works well enough for doors, but is not at all robust.
    */

    // Skulpt world, as seen from JavaScript, wraps values in "builtin" types. These functions
    // convert them back and forth. I would think Skulpt would already have something like this
    // available, but it wasn't obvious.
    var jsToPy = function (jsVal) {
        var skType = {
            'boolean': Sk.builtin.bool,
            'number': Sk.builtin.nmber,
            'string': Sk.builtin.str
        }[typeof jsVal]
        if (skType) {
            return skType(jsVal)
        } else if (typeof jsVal.length === 'number') {
            var pyList = []
            for (var i = 0; i < jsVal.length; i++) {
                pyList[i] = jsToPy(jsVal[i])
            }
            return Sk.builtin.list(pyList)
        } else {
            console.error(jsVal)
            throw 'Unable to convert value to Skulpt type' 
        }
    }
    var pyToJs = function (pyVal) {
        if (pyVal instanceof Sk.builtin.dict) {
            var jsDict = {}
            for (var k in pyVal) {
                if (pyVal[k].items) {
                    var item = pyVal[k].items[0]
                    jsDict[item.lhs.v] = pyToJs(item.rhs)
                }
            }
            return jsDict
        }
        if (pyVal instanceof Sk.builtin.list) {
            var jsArray = []
            for (var i = 0; i < pyVal.v.length; i++) {
                jsArray[i] = pyToJs(pyVal.v[i])
            }
            return jsArray
        }
        // This probably fails in many cases, but I don't know enough about how Skulpt works to
        // simply and reliably check for them
        return pyVal.v
    }

    $.ajax('doors.py', {dataType: 'text', async: false})
    .done(function (source) {
        var pyModule = Sk.importMainWithBody('doors', false, source)
        var jsModule = {}
        var pyFunctionToJs = function (pyObj, name) {
            return function () {
                var fn = pyObj.tp$getattr(name)
                var r = Sk.misceval.apply(fn, null, null, null, jsToPy(arguments).v)
                return pyToJs(r)
            }
        }
        var pyClassToJs = function (classname, properties, methods) {
            // Mimic a Python API in JavaScript. Warning: barely good enough for the simple
            // doors classes
            jsModule[classname] = function () {
                if (this instanceof jsModule[classname]) {
                    var pyCtor = pyModule.tp$getattr(classname)
                    var pyObj = Sk.misceval.apply(pyCtor, null, null, null, jsToPy(arguments).v)
                    var jsObj = this
                    var jsPropsToPy = function () {
                        $.each(properties, function (i, name) {
                            var jsVal = jsToPy(jsObj[name])
                            pyObj.tp$setattr(name, jsVal)
                        })
                    }
                    var pyPropsToJs = function () {
                        $.each(properties, function (i, name) {
                            var skVal = pyObj.tp$getattr(name)
                            jsObj[name] = pyToJs(skVal)
                        })
                    }
                    pyPropsToJs()
                    $.each(methods, function (i, name) {
                        var fn = pyFunctionToJs(pyObj, name)
                        jsObj[name] = function () {
                            jsPropsToPy()
                            var r = fn.apply(this, arguments)
                            pyPropsToJs()
                            return r
                        }
                    })
                } else {
                    throw 'Use "new" to create a ' + classname
                }
            }
        }

        pyClassToJs('RevolvingDoor',
            ['granularity', 'tolerance', 'arriving', 'occupied', 'position'],
            ['step', 'angle'])
        pyClassToJs('SwingingDoor',
            ['granularity', 'open', 'arriving', 'occupied', 'position'],
            ['step', 'angle'])
        jsModule.scenario = pyFunctionToJs(pyModule, 'scenario')
        jsModule.split = pyFunctionToJs(pyModule, 'split')
        window.doors = jsModule
    })
})()

doors.fault = function (message) {
    $('<li></li>').text(message).appendTo('.faults')
}
doors.fatal = function (message) {
    message = 'Fatal: ' + message;
    doors.fault(message)
    throw message
}

;(function () {
    'use strict'
    /* Set up a renderer that draws a door on a canvas */
    var rotation = Math.PI / 2
    doors.renderer = function (revolver, swinger, canvas) {
        var _ = canvas.getContext('2d')
        var drawRadial = function (angle, start, stop, color) {
            // Angle in radians and start and stop are distance from center in fractions of radius
            // length. Color optional.
            _.beginPath()
            _.moveTo(this.polar.x(angle, start), this.polar.y(angle, start))
            _.lineTo(this.polar.x(angle, stop), this.polar.y(angle, stop))
            _.strokeStyle = color || 'black'
            _.stroke()
        }
        var radius = canvas.width / 8
        var polar = function (door) {
            return {
                x: function (angle, distance) {
                    return door.pivot.x + radius * distance * Math.cos(angle + rotation)
                },
                y: function (angle, distance) {
                    return door.pivot.y + radius * distance * Math.sin(angle + rotation)
                }
            }
        }
        var drawPerson = function (x, y) {
            _.beginPath()
            var size = radius / 4
            _.moveTo(x, y - size / 2)
            _.lineTo(x + size / 2, y + size / 2)
            _.lineTo(x - size / 2, y + size / 2)
            _.closePath()
            _.stroke()
        }
        var _r = {
            pivot: {
                x: Math.floor(canvas.width / 4),
                y: Math.floor(canvas.height / 2)
            },
            drawRadial: drawRadial,
            stepAngle: Math.PI * 2 / revolver.granularity,
            draw: function (offset) {
                // Reverse angles while drawing so door rotates counter-clockwise, (top-down view)
                // Enclosure
                _.strokeStyle = 'black'
                _.beginPath()
                _.arc(this.pivot.x, this.pivot.y, radius, -Math.PI / 4 * 3 + rotation,
                                                          -Math.PI / 4 + rotation)
                _.stroke()
                _.beginPath()
                _.arc(this.pivot.x, this.pivot.y, radius, Math.PI / 4 * 3 + rotation,
                                                          Math.PI / 4 + rotation, true)
                _.stroke()
                // Wings
                for (var cell = 0; cell < 4; cell++) {
                    var centerAngle = -revolver.angle(cell) + offset
                    var wingAngle = centerAngle + Math.PI / 4
                    // Colors help visually verify the revolver does not skip angles
                    var wingColor = ['blue', 'red', 'green', 'black'][cell]
                    this.drawRadial(wingAngle, 0, 1, wingColor)
                    _.textBaseline = 'middle'
                    _.textAlign = 'center'
                    _.fillText(cell, this.polar.x(centerAngle, 0.7), this.polar.y(centerAngle, 0.7))
                }
                // Steps
                for (var step = 0; step < revolver.granularity; step++) {
                    var stepAngle = Math.PI * 2 / revolver.granularity * step
                    this.drawRadial(stepAngle, 0.95, 1)
                }
                // Tolerance
                this.drawRadial(revolver.tolerance, 0.3, 1, 'gray')
                this.drawRadial(-revolver.tolerance, 0.3, 1, 'gray')
                this.drawRadial(revolver.tolerance + Math.PI, 0.3, 1, 'gray')
                this.drawRadial(-revolver.tolerance + Math.PI, 0.3, 1, 'gray')
                // People
                for (var i = 1; i <= revolver.arriving; i++) {
                    var distance = i / 3 + 1
                    drawPerson(this.polar.x(0, distance), this.polar.y(0, distance))
                }
                for (var i = 0; i < 4; i++) {
                    if (revolver.occupied[i]) {
                        var angle = -revolver.angle(i) + offset
                        drawPerson(this.polar.x(angle, 0.7), this.polar.y(angle, 0.7))
                    }
                }
            }
        }
        _r.polar = polar(_r)

        var _s = {
            pivot: {
                x: Math.floor(canvas.width / 4 * 3),
                y: Math.floor(canvas.height / 2)
            },
            drawRadial: drawRadial,
            stepAngle: Math.PI / 2 / swinger.granularity,
            draw: function (offset) {
                // Door
                var angle = -swinger.angle() + Math.PI / 2 + offset
                this.drawRadial(angle, 0, 1)
                // Steps
                for (var step = 0; step <= swinger.open; step++) {
                    var stepAngle = Math.PI / 2 - Math.PI / 2 * step / swinger.granularity
                    this.drawRadial(stepAngle, 0.95, 1)
                }
                // People
                var waiting = swinger.arriving
                if (swinger.occupied[0]) {
                    if (offset === 0) { // door is looks open enough to enter
                        var middleAngle = Math.PI / 4
                        drawPerson(this.polar.x(middleAngle, 0.7), this.polar.y(middleAngle, 0.7))
                    } else {
                        ++waiting
                    }
                }
                for (var i = 0; i < waiting; i++) {
                    var personX = this.pivot.x - radius / 2
                    var personY = this.pivot.y + radius * (i / 3 + 1)
                    drawPerson(personX, personY)
                }
            }
        }
        _s.polar = polar(_s)

        var draw = function (rOffset, sOffset) {
            _.clearRect(0, 0, canvas.width, canvas.height)
            _r.draw(rOffset || 0)
            _s.draw(sOffset || 0)
        }

        draw()
        var now = (function () {
            var loaded = Date.now()
            return 
        })()
        return {
            draw: draw,
            step: function (duration, rSteps, sSteps, done) {
                if (duration < 0) {
                    doors.fatal('Illegal duration ' + duration)
                }
                // Android browser, as of Android 4.1.1, at least, seems to implement
                // requestAnimationFrame, but not performance.now. I don't know, in that case,
                // whether the time parameter to requestAnimationFrame is based on
                // window.performance or not, so don't set start using Date.now, just in case.
                // Assume browsers that implement performance.now also use it as the parameter to
                // requestAnimationFrame.
                var startTime = window.performance && performance.now ? performance.now() : null
                var offsetAngle = function (door, steps, time) {
                    // Starts at size of step radians and decreases to zero
                    var offset = door.stepAngle * steps * (1 - (time - startTime) / duration)
                    return steps > 0 ? Math.max(0, offset) : Math.min(0, offset)
                }
                var tick = function (time) {
                    startTime = startTime || time
                    var rOffset = offsetAngle(_r, rSteps, time)
                    var sOffset = offsetAngle(_s, sSteps, time)
                    draw(rOffset, sOffset)
                    if (!rOffset && !sOffset && time - startTime >= duration) {
                        done()
                    } else {
                        requestAnimationFrame(tick)
                    }
                }
                requestAnimationFrame(tick)
            }
        }
    }
})()

;(function () {
    'use strict'
    /* Set up a player that draws doors on a canvas, allowing playing, pausing and stepping */

    doors.player = function (revolver, swinger, canvas) {
        var renderer = doors.renderer(revolver, swinger, canvas)
        var player = (function () {
            var paused = true
            var play = function (millisPerStep) {
                if (!(millisPerStep > 0)) {
                    throw 'Need positive step time, not ' + millisPerStep
                }
                ;(function run () {
                    if (paused) {
                        return
                    }
                    var rSteps = revolver.step()
                    var sSteps = swinger.step()
                    renderer.step(millisPerStep, rSteps, sSteps, function () {
                        player.onstep.revolver()
                        player.onstep.swinger()
                        requestAnimationFrame(run)
                    })
                })()
            }
            return {
                pause: function () {
                    paused = true
                },
                play: function (millisPerStep) {
                    if (paused) {
                        paused = false
                        play(millisPerStep)
                    }
                },
                step: function (duration, done) {
                    renderer.step(duration, revolver.step(), swinger.step(), done)
                },
                onstep: {
                    revolver: $.noop,
                    swinger: $.noop
                },
                draw: renderer.draw
            }
        })()
        return player
    }
})()

;(function () {
    'use strict'
    /* Create a monitor that renders a door from server-side info */

    doors.monitor = function (revolver, swinger, canvas) {
        var renderer = doors.renderer(revolver, swinger, canvas)
        var step = 0
        var stopped = true
        var reset = true
        var model = {
            revolver: revolver,
            swinger: swinger
        }
        var priorCommands
        var nextStep = function () {
            $.getJSON('/step')
            .done(function (commands) {
                var sync = function () {
                    step = commands.step
                    $.each(model, function (doorName, door) {
                        $.each(['arriving', 'occupied', 'position'], function (i, k) {
                            door[k] = commands[doorName][k]
                        })
                    })
                }
                if (stopped) {
                    return
                }
                if (reset) {
                    // Could reset every time, but to simulate the physical door, only reset when
                    // switching from local playback to monitoring the door server. Since the
                    // physical door has no "reset" capability, tracking it helps test that the
                    // server does not get out of sync.
                    sync()
                    reset = false
                }
                if (commands.duration === 0) {
                    // Sometimes a request falls right on the boundary, so the next step time passed
                    // but the timer hasn't advanced the model yet
                    nextStep()
                    return
                }
                if (commands.step !== step) {
                    console.error(priorCommands, commands)
                    doors.fault('Missed step ' + step)
                    sync()
                }
                priorCommands = commands
                ++step
                var renderArgs = [commands.duration]
                $.each(model, function (doorName, door) {
                    door.arriving += commands[doorName].arrived
                    var steps = door.step()
                    renderArgs.push(steps)
                    if (doorName === 'revolver' && commands.revolver.rotate !== steps) {
                        doors.fatal('Revolver out of sync')
                    }
                    if (doorName === 'swinger' && commands.swinger.angle !== swinger.angle()) {
                        doors.fatal('Swinger out of sync')
                    }
                })
                renderArgs.push(nextStep)
                renderer.step.apply(renderer, renderArgs)
            })
            .fail(function (xhr) {
                doors.fatal('Step request failed: ' + xhr.status)
            })
        }
        var controls = function (doorName) {
            return {
                arrive: function () {
                    $.post('/arrive/' + doorName)
                    .done(function () {
                        ++model[doorName].arriving
                        renderer.draw()
                    })
                    .fail(function (xhr) {
                        doors.fault('Arrival command failed: ' + xhr.status)
                    })
                },
                load: function (scenario) {
                    return $.post('/start/' + doorName + '/' + scenario)
                    .done(function (status) {
                        if (stopped) {
                            stopped = false
                            reset = true
                            nextStep()
                        }
                    })
                    .fail(function (xhr) {
                        doors.fault('Start request failed: ' + xhr.status)
                    })
                }
            }
        }
        return {
            revolver: controls('revolver'),
            swinger: controls('swinger'),
            stop: function () {
                stopped = true
            },
            draw: renderer.draw
        }
    }
})()

/* Plotting and data loading functionality for charting */
doors.plot = function (canvas, results, scenarios, scale) {
    'use strict'

    if (!results.length) {
        return
    }

    scale = scale || {}
    var gutter = {
        x: 0,
        y: Math.floor(canvas.height * 0.05)
    }
    var scaled = function (v, axis) {
        return Math.floor((v - range[axis].min) * scale[axis] + gutter[axis])
    }
    var pos = {
        x: function (time) {
            return scaled(time, 'x')
        },
        y: function (temp) {
            return canvas.height - scaled(temp, 'y')
        }
    }
    var range = {
        x: {},
        y: {}
    }
    
    var _ = canvas.getContext('2d')
    _.clearRect(0, 0, canvas.width, canvas.height)

    range.x.min = results[0].time
    range.x.max = results[results.length - 1].time
    range.y = {}
    $.each(results, function (i, point) {
        var min = Math.min.apply(Math, point.temps)
        var max = Math.max.apply(Math, point.temps)
        range.y.min = range.y.min == null ? min : Math.min(range.y.min, min)
        range.y.max = range.y.max == null ? max : Math.max(range.y.max, max)
    })

    if (scale.x == null) {
        scale.x = Math.min((canvas.width - gutter.x) / ((range.x.max - range.x.min) || 1),
                           canvas.width * 0.01)
    }
    if (scale.y == null) {
        scale.y = (canvas.height - gutter.y * 2) / ((range.y.max - range.y.min) || 1)
    }

    // Gridlines every ten minutes, dark line every hour
    for (var gridLine = range.x.min + 10 * 60; gridLine < range.x.max; gridLine += 10 * 60) {
        _.fillStyle = (gridLine - range.x.min) % (10 * 60 * 6) === 0 ? 'black' : 'lightgray'
        _.fillRect(pos.x(gridLine), 0, 1, scale.y)
    }

    // Scenario changes
    $.each(scenarios, function (i, row) {
        _.fillStyle = 'gray'
        _.fillRect(pos.x(row[0]), 0, 1, canvas.height)
    })

    // Results
    var xSize = Math.ceil(Math.max(scale.x, 1))
    var priorX
    $.each(results, function (i, point) {
        var x = pos.x(point.time)
        if (x === priorX) {
            return
        }
        priorX = x

        // Arrivals
        $.each(point.arrivals, function (doorName, ppm) {
            var direction = doorName === 'revolver' ? 1 : -1 // up or down, that is
            var offset = Math.floor(direction * ppm * scale.y / 2)
            var midY = Math.floor((canvas.height - gutter.x) / 2 + gutter.x)
            _.fillStyle = 'lightgray'
            _.fillRect(x - xSize, midY + direction, xSize, offset)
        })

        var plotTemp = function (temp, color, fill) {
            var y = pos.y(temp)
            _.fillStyle = color
            // Difference between top and bottom indicates precision
            var yMin = Math.floor(y - scale.y / 2)
            var yMax = Math.floor(y + scale.y / 2)
            if (fill) {
                _.fillRect(x - xSize, yMin, xSize, scale.y)
            } else {
                _.fillRect(x - xSize, yMin, xSize, 1)
                _.fillRect(x - xSize, yMax, xSize, 1)
            }
        }

        // Temperature
        $.each(point.temps, function (j, temp) {
            plotTemp(temp, ['indigo', 'blue', 'indianred', 'maroon'][j])
        })
        // Temperature difference (average indoor - average outdoor)
        plotTemp(point.delta() + (range.y.max - range.y.min) / 2, 'black', true)
    })
    var index = function (x) {
        var pos = Math.floor(x / (canvas.width - gutter.x) * results.length)
        if (pos > results.length - 1) {
            return results.length - 1
        }
        if (pos < 0) {
            return 0
        }
        return pos
    }
    return {
        point: function (x) {
            /* Given a coordinate relative to canvas dimensions, return the data point that
               corresponds */
            return results[index(x)]
        },
        range: function (x) {
            /* Given a coordinate relative to canvas dimensions, return the scenario range that
               overlaps that coordinate. When given no x-coordinate, return the chart's entire
               range.
            */
            if (x == null) {
                return {
                    min: results[0].time,
                    max: results[results.length - 1].time
                }
            }
            var p = results[index(x)]
            var running = {}
            var range = {
                min: 0,
                max: null
            }
            $.each(scenarios, function (i, s) {
                running[s[1]] = s[2]
                if (s[0] < p.time) {
                    range.min = s[0]
                    $.extend(range, running)
                }
                if (range.max == null && s[0] > p.time) {
                    range.max = s[0]
                }
            })
            return range
        },
        slice: function (range) {
            if (!range) {
                return {
                    results: results,
                    scenarios: scenarios
                }
            } else {
                var s = function (a) {
                    return $.grep(a, function (v) {
                        return v.time >= range.min && (range.max == null || v.time <= range.max)
                    })
                }
                return {
                    results: s(results),
                    scenarios: s(scenarios)
                }
            }
        },
        scale: scale,
        pos: pos
    }
}

doors.results = function (resultsUrl, scenariosUrl, interval) {
    'use strict'

    var onupdate = []

    return (function () {
        var point = function (row) {
            return {
                time: row[0],
                arrivals: {
                    revolver: row[1],
                    swinger: row[2]
                },
                temps: row.slice(3),
                delta: function () {
                    return (this.temps[2] + this.temps[3] - this.temps[0] - this.temps[1]) / 2
                }
            }
        }
        var csv = function (text) {
            var lines = $.grep(text.split(/$/gm), function (line) {
                return !/^\s*$/.test(line)
            })
            return $.map(lines, function (line) {
                return [$.map(line.split(/,/g), function (x, i) {
                    if (/\d+(?:\.\d+)/.test(x)) {
                        return parseFloat(x)
                    }
                    return x
                })] // jQuery.map flattens arrays one level
            })
        }
        var onready = []
        var tick = function () {
            return $.when(
                $.get(resultsUrl, null, null, 'text'),
                $.get(scenariosUrl, null, null, 'text'))
            .done(function (resultsReply, scenariosReply) {
                var results = $.map(csv(resultsReply[0]), function (row) {
                    return point(row)
                })
                var scenarios = csv(scenariosReply[0])
                if (interval) {
                    setTimeout(tick, interval)
                }
                $.each(onupdate, function (i, fn) {
                    fn(results, scenarios)
                })
            })
            .fail(function () {
                doors.fatal('No results data')
            })
        }
        tick()
        return {
            onupdate: function (fn) {
                onupdate.push(fn)
            }
        }
    })()
}

/* An interactive chart using the markup structure from chart.html */
doors.chart = function (container) {
    'use strict'

    container = $(container)
    var canvas = container.find('canvas')[0]

    var timeText = function (seconds) {
        seconds = Math.round(seconds)
        var hours = Math.floor(seconds / 60 / 60)
        seconds -= hours * 60 * 60
        var minutes = Math.floor(seconds / 60)
        return hours + ':' + ('00' + minutes).slice(-2)
    }

    var plot // set when updated
    var displayValues = function (position) {
        if (!plot) {
            return
        }
        var point = plot.point(position)
        var row = container.find('table.points tbody tr').last()
        row.find('.time').text(timeText(point.time))
        var readings = row.find('.temp.readings ol').empty()
        $.each(point.temps, function (i, temp) {
            $('<li class="temp value"></li>').text(Math.round(temp / 3))
                .appendTo(readings)
        })
        row.find('.temp.delta').text(Math.round(point.delta() / 3))
        container.find('table.points .temp.value').each(function (i) {
            var node = $(this)
            var top = plot.pos.y(parseFloat(node.text()) * 3) - node.height() * 1.5
            top -= node.is('.delta')
                ? container.find('canvas').height() / 2
                : 0
            node.css({
                position: 'absolute',
                top: top,
                left: plot.pos.x(point.time)
            })
        })
        $.each(point.arrivals, function (k, v) {
            row.find('.arrivals.' + k).text(v)
        })
    }
    var canvasX = function (event) { // X position relative to canvas
        return event.originalEvent.pageX - container.find('canvas.plot').offset().left
    }

    container.find('.position input')
        .attr({
            min: 0,
            max: container.find('canvas.plot').attr('width')
        })
        .val(container.find('canvas.plot').attr('width'))
        .on('change', function () {
            displayValues($(this).val())
        })
        .removeAttr('disabled')
    container.find('canvas.plot').on('mousemove', function (event) {
        container.find('.position input')
            .val(canvasX(event))
            .trigger('change')
    })

    var zoomNext = 0

    var zoomIn = function (event) {
        if (!plot) {
            return
        }
        var range = plot.range(canvasX(event))
        var sliced = plot.slice(range)
        doors.plot(
            container.find('.zoomed canvas')[zoomNext],
            sliced.results, sliced.scenarios,
            {y: plot.scale.y})
        zoomNext = (zoomNext + 1) % container.find('.zoomed canvas').length
        displayValues(canvasX(event))
    }
    container.find('canvas').on('click', zoomIn)

    return {
        update: function (results, scenarios) {
            plot = doors.plot(canvas, results, scenarios)
            displayValues(container.find('.position input').val())
        }
    }
}
