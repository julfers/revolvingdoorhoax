if ('/' === window.location.pathname || /^\/index\.html/.test(window.location.pathname)) {
    $('html').addClass('home')
}

$(document).ready(function () {
    // Slightly modified test for MathML support from https://github.com/fred-wang/mathml.css
    var box, div, link, namespaceURI;
    // First check whether the page contains any <math> element.
    namespaceURI = "http://www.w3.org/1998/Math/MathML";
    if (document.body.getElementsByTagNameNS(namespaceURI, "math").length) {
        // Create a div to store the test, using Kuma's "offscreen" CSS
        div = document.createElement("div");
        div.style.border = "0";
        div.style.clip = "rect(0 0 0 0)"
        div.style.height = "1px";
        div.style.margin = "-1px";
        div.style.overflow = "hidden";
        div.style.padding = "0";
        div.style.position = "absolute";
        div.style.width = "1px";
        // Verify the support for the <mspace> element.
        div.innerHTML = "<math xmlns='" + namespaceURI + "'><mspace height='23px' width='77px'/></math>";
        document.body.appendChild(div);
        box = div.firstChild.firstChild.getBoundingClientRect();
        document.body.removeChild(div);
        if (Math.abs(box.height - 23) > 1 || Math.abs(box.width - 77) > 1) {
            // Insert the MathJax.js script.
            link = document.createElement("link");
            link.href = "style/lib/mathml.css";
            link.rel = "stylesheet";
            document.head.appendChild(link);
        }
    }
})

// Configure and run ascii math
window.checkForMathML = false
window.mathcolor = ''
window.mathfontsize = ''
window.mathfontfamily = ''
window.translateOnLoad = false
window.translateLaTeX = false
window.showasciiformulaonhover = false
$(document).ready(function () {
    init() // initialize function defined by ascii math
    $('tt').each(function () {
        $(this).text($(this).text()) // TODO: docutils munged ```("inches of water")```, why?
        AMprocessNode(this)
    })
})
