;(function () {
'use strict'

window.doors = (function () {
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

    var jsModule = {}
    $.ajax('doors.py', {dataType: 'text', async: false})
    .done(function (source) {
        var pyModule = Sk.importMainWithBody('doors', false, source)
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
    })
    return jsModule
})()

doors.fault = function (message) {
    $('<li></li>').text(message).appendTo('.faults')
}
doors.fatal = function (message) {
    message = 'Fatal: ' + message;
    doors.fault(message)
    throw message
}

doors.renderer = (function () {
    /* Set up a renderer that draws a door on a canvas */
    var rotation = Math.PI / 2
    return function (revolver, swinger, canvas) {
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

doors.player = function (revolver, swinger, canvas) {
    /* Set up a player that draws doors on a canvas, allowing playing, pausing and stepping */
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

doors.monitor = function (revolver, swinger, canvas) {
    /* Create a monitor that renders a door from server-side info */
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

doors.plot = function (canvas, results, scenarios, scale) {
    /* Experiment result charting */
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
    var tracker = function () {
        return {
            sum: 0,
            count: 0,
            start: 0,
            average: function () {
                return this.sum / this.count
            },
            reset: function (time) {
                this.sum = 0
                this.count = 0
                this.start = time
            },
            add: function (v) {
                this.sum += v
                ++this.count
            }
        }
    }
    var scenarioTrack = {
        revolver: tracker(),
        swinger: tracker(),
        index: 0
    }
    var midY = Math.floor((canvas.height - gutter.x) / 2 + gutter.x)
    $.each(results, function (i, point) {
        var x = pos.x(point.time)
        if (x === priorX) {
            return
        }
        priorX = x

        // Arrivals
        $.each(point.arrivals, function (doorName, ppm) {
            scenarioTrack[doorName].add(ppm)
            var direction = doorName === 'revolver' ? 1 : -1 // up or down, that is
            var offset = Math.floor(ppm * scale.y / 2) * direction
            _.fillStyle = 'lightgray'
            _.fillRect(x - xSize, midY + direction, xSize, offset)
        })

        var scenario = scenarios[scenarioTrack.index] || []
        if (point.time > scenario[0]) {
            ;(function () {
                var track = scenarioTrack[scenario[1]]
                var direction = scenario[1] === 'revolver' ? 1 : -1
                var length = scaled(point.time - track.start, 'x')
                var offset = Math.floor(track.average() * scale.y / 2) * direction
                if (length > 1 && Math.abs(offset) > 1) {
                    _.fillStyle = 'black'
                    var label = scenario[1] === 'revolver' ? 'Revolving' : 'Swinging'
                    _.fillText(label, x - length, midY + offset)
                }
                track.reset(point.time)
                ++scenarioTrack.index
            })()
        }

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
    /* Load and parse experiment results, periodically, if desired */
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
            return lines.map(function (line) {
                return line.split(/,/g).map(function (x) {
                    if (/\d+(?:\.\d+)/.test(x)) {
                        return parseFloat(x)
                    }
                    return x
                })
            })
        }
        var onready = []
        var tick = function () {
            return $.when(
                $.get(resultsUrl, null, null, 'text'),
                $.get(scenariosUrl, null, null, 'text'))
            .done(function (resultsReply, scenariosReply) {
                var results = csv(resultsReply[0]).map(function (row) {
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

doors.chart = function (container) {
    /* An interactive chart using the markup structure from chart.html */
    container = $(container)
    var plotMarkup = container.find('.plot').clone()

    var timeText = function (seconds) {
        if (seconds !== seconds) {
            return ''
        }
        seconds = Math.round(seconds)
        var hours = Math.floor(seconds / 60 / 60)
        seconds -= hours * 60 * 60
        var minutes = Math.floor(seconds / 60)
        return hours + ':' + ('00' + minutes).slice(-2)
    }

    var canvasX = function (canvas, event) {
        return event.originalEvent.pageX - canvas.offset().left    
    }

    var addBehaviors = function (target, plot) {
        var canvas = target.find('canvas')

        var placeOnChart = function (node, temp, time) {
            var top = plot.pos.y(temp) - node.height() * 1.5
            top -= node.is('.delta')
                ? canvas[0].height / 2
                : 0
            return node.css({
                position: 'absolute',
                top: top,
                left: plot.pos.x(time)
            })
        }

        var displayValues = function (position) {
            var point = plot.point(position)
            var row = target.find('table.points tbody tr').last()
            row.find('.time').text(timeText(point.time))

            $.each(point.temps, function (i, temp) {
                var reading = row.find('.temp li').eq(i)
                    .text(Math.round(temp / 3))
                placeOnChart(reading, temp, point.time)
            })
            
            var delta = row.find('.temp.delta').text(Math.round(point.delta() / 3))
            placeOnChart(delta, point.delta(), point.time)

            $.each(point.arrivals, function (k, v) {
                row.find('.arrivals.' + k).text(v)
            })
        }        

        target.find('.position input')
            .attr({
                min: 0,
                max: canvas.attr('width')
            })
            .val(canvas.attr('width'))
            .on('change', function () {
                displayValues($(this).val())
            })
            .removeAttr('disabled')
        canvas.on('mousemove', function (event) {
            target.find('.position input')
                .val(canvasX(canvas, event))
                .trigger('change')
        })

        var placeLabels = function (lastPoint) {
            for (var cut = 0; cut < 2; cut++) {
                placeOnChart(target.find('.temp h4').eq(cut),
                        ( lastPoint.temps.slice(cut * 2)[0]
                        + lastPoint.temps.slice(cut * 2)[1]
                        ) / 2,
                    lastPoint.time)
            }
            placeOnChart(target.find('.temp h4.delta'), lastPoint.delta(), lastPoint.time)
        }

        return {
            refresh: function (lastPoint) {
                displayValues(target.find('.position input').val())
                placeLabels(lastPoint)
            }
        }
    };

    var create = function (scaleY) {
        var target = plotMarkup.clone()
        var canvas = target.find('canvas')
        var plot, behaviors
        return {
            update: function (results, scenarios) {
                plot = doors.plot(canvas[0], results, scenarios, {y: scaleY})
                behaviors = behaviors || addBehaviors(target, plot)
                behaviors.refresh(results[results.length - 1])
                return this
            },
            zoomed: function (event) {
                var range = plot.range(canvasX(canvas, event))
                var sliced = plot.slice(range)
                return create(plot.scale.y)
                    .update(sliced.results, sliced.scenarios)
            },
            target: target
        }
    }

    var mainPlot
    var scenarioTr = container.find('.ranges tbody tr').remove()
    return {
        update: function (results, scenarios) {
            container.find('[aria-busy]').removeAttr('aria-busy')

            var rangeTbody = container.find('.ranges tbody').empty()
            $.each(scenarios, function (i, scenario) {
                var start = parseInt(scenario[0], 10)
                var end = parseInt(scenarios[i + 1] || [][0])
                scenarioTr.clone().appendTo(rangeTbody)
                    .find('.start').text(timeText(start)).end()
                    .find('.end').text(timeText(end)).end()
                    .find('.' + scenario[1]).text(scenario[2]).end()
                    // .find('input[name=range]').on('change', function () {
                    //     create(container.find('.zoomed > div'))
                    // })
            })

            if (!mainPlot) {
                mainPlot = create()
                mainPlot.target
                    .replaceAll(container.find('.plot'))
                    .find('canvas').on('click', function (click) {
                        mainPlot.zoomed(click).target
                            .replaceAll(container.find('.zoomed > *'))
                    })
            }
            mainPlot.update(results, scenarios)
        }
    }
}

})()
