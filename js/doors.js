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
                    this.drawRadial(stepAngle, 0.95, 1, 'gray')
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
                x: Math.floor(canvas.width / 2),
                y: Math.floor(canvas.height / 2)
            },
            drawRadial: drawRadial,
            draw: function (offset) {
                this.drawRadial(swinger.angle(), 0, 1)
            }
        }
        _s.polar = polar(_s)

        var draw = function (offset) {
            offset = offset || 0
            _.clearRect(0, 0, canvas.width, canvas.height)
            _r.draw(offset)
            _s.draw(offset)
        }

        var offsetAngle = function (timeDelta, duration) {
            // Starts at size of step radians and decreases to zero
            var offset = Math.PI * 2 / revolver.granularity * (1 - timeDelta / duration)
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
                    if (revolver.step()) {
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
                    if (revolver.step()) {
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
        var renderer = doors.renderer(door, null, canvas)
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
                            _.fillText(Math.round(v / 3), x + 2, y)
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
