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
        if (typeof jsVal.length === 'number') {
            var pyList = []
            for (var i = 0; i < jsVal.length; i++) {
                pyList[i] = jsToPy(jsVal[i])
            }
            return Sk.builtin.list(pyList)
        } else {
            return {
                'number': Sk.builtin.nmber,
                'boolean': Sk.builtin.bool
            }[typeof jsVal](jsVal)
        }
    }
    var pyToJs = function (pyVal) {
        if (pyVal instanceof Sk.builtin.list) {
            var jsArray = []
            for (var i = 0; i < pyVal.v.length; i++) {
                jsArray[i] = pyToJs(pyVal.v[i])
            }
            return jsArray
        } else {
            // This probably fails in many cases, but I don't know enough about how Skulpt works
            // to simply and reliably check for them
            return pyVal.v
        }
    }

    $.ajax('doors.py', {dataType: 'text', async: false})
    .done(function (source) {
        var pyModule = Sk.importMainWithBody('doors', false, source)
        var jsModule = {}
        var pyToJsApi = function (classname, properties, methods) {
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
                        jsObj[name] = function () {
                            jsPropsToPy()
                            var fn = pyObj.tp$getattr(name)
                            var r = Sk.misceval.apply(fn, null, null, null, jsToPy(arguments).v)
                            pyPropsToJs()
                            return pyToJs(r)
                        }
                    })
                } else {
                    throw 'Use "new" to create a ' + classname
                }
            }
        }

        pyToJsApi('RevolvingDoor',
            ['granularity', 'tolerance', 'arriving', 'occupied', 'position'],
            ['step', 'angle'])
        window.doors = jsModule
    })
})()

doors.fault = function (message) {
    $('<span></span>').text(message).appendTo('.fault')
    throw message
}

;(function () {
    'use strict'
    /* Set up a renderer that draws a door on a canvas */
    doors.renderer = function (door, canvas) {
        var _ = canvas.getContext('2d')
        var center = {
            x: Math.floor(canvas.width / 2),
            y: Math.floor(canvas.height / 2)
        }
        var radius = Math.floor(Math.min(center.x, center.y) / 2)
        var radialX = function (angle, distance) {
            // Distance in fractions of radius
            return center.x + radius * distance * Math.cos(angle)
        }
        var radialY = function (angle, distance) {
            return center.y + radius * distance * Math.sin(angle)
        }
        var drawRadial = function (angle, start, stop, color) {
            // Angle in radians and start and stop are distance from center in fractions of radius
            // length. Color optional.
            _.beginPath()
            _.moveTo(radialX(angle, start), radialY(angle, start))
            _.lineTo(radialX(angle, stop), radialY(angle, stop))
            _.strokeStyle = color || 'black'
            _.stroke()
        }
        var drawDoor = function (offset) {
            // Reverse angles while drawing so door rotates counter-clockwise, (top-down view)
            // Door enclosure
            _.strokeStyle = 'black'
            _.beginPath()
            _.arc(center.x, center.y, radius, -Math.PI / 4 * 3, -Math.PI / 4)
            _.stroke()
            _.beginPath()
            _.arc(center.x, center.y, radius, Math.PI / 4 * 3, Math.PI / 4, true)
            _.stroke()
            // Door
            for (var cell = 0; cell < 4; cell++) {
                var centerAngle = -door.angle(cell) + offset
                var wingAngle = centerAngle + Math.PI / 4
                // Colors help visually verify the door does not skip angles
                var wingColor = ['blue', 'red', 'green', 'black'][cell]
                drawRadial(wingAngle, 0, 1, wingColor)
                _.textBaseline = 'middle'
                _.fillText(cell, radialX(centerAngle, 0.7), radialY(centerAngle, 0.7))
            }
            // Steps
            for (var step = 0; step < door.granularity; step++) {
                var stepAngle = Math.PI * 2 / door.granularity * step
                drawRadial(stepAngle, 0.95, 1, 'gray')
            }
            // Tolerance
            drawRadial(door.tolerance, 0.3, 1, 'gray')
            drawRadial(-door.tolerance, 0.3, 1, 'gray')
            drawRadial(door.tolerance + Math.PI, 0.3, 1, 'gray')
            drawRadial(-door.tolerance + Math.PI, 0.3, 1, 'gray')
        }
        var drawPerson = function (x, y, direction) {
            _.beginPath()
            _.moveTo(x, y)
            _.lineTo(x + 20 * direction, y + 10)
            _.lineTo(x + 20 * direction, y - 10)
            _.lineTo(x, y)
            _.fill()
        }

        var drawPeople = function (offset) {
            for (var i = 1; i <= door.arriving; i++) {
                var distance = radius + radius / 2 * i
                drawPerson(center.x + distance, center.y, 1)
            }
            for (var i = 0; i < 4; i++) {
                if (door.occupied[i]) {
                    var angle = -door.angle(i) + offset
                    drawPerson(
                        center.x + radius / 2 * Math.cos(angle),
                        center.y + radius / 2 * Math.sin(angle),
                        1)
                }
            }
        }

        var draw = function (offset) {
            offset = offset || 0
            _.clearRect(0, 0, canvas.width, canvas.height)
            drawDoor(offset)
            drawPeople(offset)
        }

        var offsetAngle = function (timeDelta, duration) {
            // Starts at size of step radians and decreases to zero
            var offset = Math.PI * 2 / door.granularity * (1 - timeDelta / duration)
            return offset <= 0 ? 0 : offset
        }

        return {
            draw: draw,
            step: function (duration, done) {
                if (duration < 0) {
                    doors.fault('Illegal duration ' + duration)
                }
                var startTime = performance.now()
                var tick = function (time) {
                    var offset = offsetAngle(time - startTime, duration)
                    draw(offset)
                    if (offset === 0) {
                        draw()
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

    doors.player = function (door, canvas) {
        var renderer = doors.renderer(door, canvas)
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
                    if (door.step()) {
                        renderer.step(millisPerStep, function () {
                            player.onstep()
                            requestAnimationFrame(run)
                        })
                    } else {
                        renderer.draw()
                        setTimeout(function () {
                            player.onstep()
                            renderer.draw()
                            requestAnimationFrame(run)
                        }, millisPerStep)
                    }
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
                    if (door.step()) {
                        renderer.step(duration, done)
                    } else {
                        renderer.draw()
                        setTimeout(function () {
                            player.onstep()
                            done()
                        }, duration)
                    }
                },
                onstep: $.noop,
                draw: renderer.draw
            }
        })()
        return player
    }
})()

;(function () {
    'use strict'
    /* Create a monitor that renders a door from server-side info */

    doors.monitor = function (door, canvas) {
        var renderer = doors.renderer(door, canvas)
        var step = 0
        var stopped = true
        var reset = true
        var nextStep = function () {
            $.getJSON('/step')
            .done(function (commands) {
                if (stopped) {
                    return
                }
                if (reset) {
                    // Could reset every time, but to simulate the physical door, only reset when
                    // switching from local playback to monitoring the door server. Since the
                    // physical door has no "reset" capability, tracking it helps test that the
                    // server does not get out of sync.
                    step = commands.step
                    door.arriving = commands.arriving
                    door.occupied = commands.occupied
                    door.position = commands.position
                    reset = false
                }
                if (commands.step === 0 && step > 0) {
                    // switching to the next scenario
                    step = 0
                }
                if (commands.step !== step) {
                    doors.fault('Missed step ' + step)
                }
                ++step
                door.arriving += commands.arrived
                var stepped = door.step()
                if (commands.rotate) {
                    if (!stepped) {
                        doors.fault('Door out of sync')
                    }
                    renderer.step(commands.duration, function () {
                        nextStep()
                    })
                } else {
                    setTimeout(nextStep, commands.duration)
                    renderer.draw()
                }
            })
            .fail(function (xhr) {
                doors.fault('Step request failed: ' + xhr.status)
            })
        }
        return {
            arrive: function () {
                $.ajax({type: 'post', url: '/arrive'})
                .fail(function (xhr) {
                    doors.fault('Arrival request failed: ' + xhr.status)
                })
                ++door.arriving
                renderer.draw()
            },
            stop: function () {
                stopped = true
            },
            load: function (scenario, done) {
                $.ajax({type: 'post', url: '/start/' + scenario, contentType: 'application/json',
                    data: JSON.stringify({
                        turns_per_sec: 0.2
                    })
                })
                .done(function (status) {
                    if (stopped) {
                        stopped = false
                        reset = true
                        nextStep()
                    }
                    done()
                })
                .fail(function (xhr) {
                    doors.fault('Start request failed: ' + xhr.status)
                })
            },
            draw: renderer.draw
        }
    }
})()

;(function () {
    'use strict'
    doors.plot = function (url, canvas, interval) {
        var _ = canvas.getContext('2d')

        var render = function (csv) {
            _.clearRect(0, 0, canvas.width, canvas.height)
            var maxY = 0
            var lines = $.grep(csv.split(/$/gm), function (line) {
                return !/^\s*$/.test(line)
            })
            lines = $.map(lines, function (line) {
                return [$.map(line.split(/,/g), function (x, i) {
                    var v = parseInt(x, 10)
                    if (i > 1) {
                        maxY = maxY < v ? v : maxY
                    }
                    return v
                })] // jQuery.map flattens arrays one level
            })
            var minX = lines[0][0]
            var maxX = lines[lines.length - 1][0]
            var scaleX = Math.min((canvas.width * 0.95) / (maxX - minX), canvas.width * 0.01)
            var scaleY = (canvas.height * 0.95) / maxY
            for (var gridLine = minX + 10 * 60; gridLine < maxX; gridLine += 10 * 60) {
                // Gridlines every ten minutes, dark line every hour
                _.fillStyle = (gridLine - minX) % (10 * 60 * 6) === 0 ? 'black' : 'lightgray'
                var x = Math.floor(gridLine * scaleX)
                _.fillRect(x, 0, 1, scaleY)
            }
            var colors = [null, 'gray', 'indigo', 'blue', 'indianred', 'maroon']
            var xSize = Math.floor(Math.max(canvas.width * 0.95 / lines.length, 1))
            $.each(lines, function (i, line) {
                var x = Math.floor((line[0] - minX) * scaleX - scaleX / 2)
                $.each(line, function (j, v) {
                    var y = Math.floor(canvas.height - v * scaleY - scaleY / 2)
                    if (j != 0) {
                        if (i === lines.length - 1) {
                            _.fillStyle = 'black'
                            _.textBaseline = 'middle'
                            _.fillText(v, x + 2, y)
                        }
                        _.fillStyle = colors[j]
                        _.fillRect(x - xSize, y, xSize, 1)
                        _.fillStyle = 'lightgray'
                        _.fillRect(x - xSize, Math.floor(y - scaleY / 2), xSize, 1)
                        _.fillRect(x - xSize, Math.floor(y + scaleY / 2), xSize, 1)
                    }
                })
            })
        }

        var tick = function () {
            $.get(url, null, null, 'text')
            .done(function (csv) {
                render(csv)
                if (interval) {
                    setTimeout(tick, interval)
                }
            })
            .fail(function (xhr) {
                console.error(xhr.status)
            })
        }
        tick()
    }
})()
