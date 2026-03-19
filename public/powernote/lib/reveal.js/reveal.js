/**
 * Simplified Reveal.js for PowerNote
 * Provides essential presentation functionality
 */

window.Reveal = function(options) {
    const config = Object.assign({
        hash: false,
        controls: true,
        progress: true,
        center: true,
        transition: 'slide',
        embedded: false,
        touch: true,
        loop: false,
        rtl: false,
        navigationMode: 'default'
    }, options || {});

    let dom = {};
    let state = {
        indexh: 0,
        indexv: 0,
        previousSlide: null,
        currentSlide: null,
        scale: 1
    };

    let slides = [];
    let horizontalSlides = [];
    let backgrounds = [];
    let progressBar = null;
    let controls = {};

    // Initialize the presentation
    function initialize() {
        return new Promise((resolve) => {
            setupDOM();
            setupSlides();
            setupControls();
            setupProgress();
            setupKeyboard();
            
            // Initial slide
            slide(0, 0);
            
            // Update progress
            updateProgress();
            
            resolve();
        });
    }

    function setupDOM() {
        dom.wrapper = document.querySelector('.reveal');
        dom.slides = document.querySelector('.reveal .slides');
        
        if (!dom.wrapper || !dom.slides) {
            console.error('Reveal.js: .reveal or .reveal .slides not found');
            return;
        }
    }

    function setupSlides() {
        slides = Array.from(dom.slides.querySelectorAll('section'));
        horizontalSlides = Array.from(dom.slides.querySelectorAll('section:not(.stack) > section, section:not(.stack)'));
        
        slides.forEach((slide, index) => {
            slide.setAttribute('data-index-h', index);
            slide.classList.add('future');
        });

        if (slides.length > 0) {
            slides[0].classList.remove('future');
            slides[0].classList.add('present');
            state.currentSlide = slides[0];
        }
    }

    function setupControls() {
        // 不生成右下角圓框控制按鈕
        return;
    }

    function setupProgress() {
        if (!config.progress) return;

        const progressHTML = '<div class="progress"><span></span></div>';
        dom.wrapper.insertAdjacentHTML('beforeend', progressHTML);
        progressBar = dom.wrapper.querySelector('.progress span');
    }

    function setupKeyboard() {
        document.addEventListener('keydown', onDocumentKeyDown);
    }

    function onDocumentKeyDown(event) {
        if (!dom.wrapper) return;

        let triggered = false;

        switch (event.keyCode) {
            case 37: // Left
                navigateLeft(); 
                triggered = true; 
                break;
            case 39: // Right  
                navigateRight(); 
                triggered = true; 
                break;
            case 38: // Up
                navigateUp(); 
                triggered = true; 
                break;
            case 40: // Down
                navigateDown(); 
                triggered = true; 
                break;
            case 32: // Space
                if (event.shiftKey) {
                    navigateLeft();
                } else {
                    navigateRight();
                }
                triggered = true;
                break;
        }

        if (triggered) {
            event.preventDefault();
        }
    }

    function slide(h, v, f) {
        const previousH = state.indexh;
        const previousV = state.indexv;

        state.indexh = Math.max(Math.min(h, slides.length - 1), 0);
        state.indexv = Math.max(Math.min(v || 0, 0), 0);

        if (state.indexh === previousH && state.indexv === previousV) {
            return;
        }

        updateSlides(previousH, previousV);
        updateProgress();
        updateControls();
    }

    function updateSlides(previousH, previousV) {
        const currentSlide = slides[state.indexh];
        const previousSlide = slides[previousH];

        if (previousSlide && previousSlide !== currentSlide) {
            previousSlide.classList.remove('present', 'past', 'future');
            
            if (state.indexh > previousH) {
                previousSlide.classList.add('past');
            } else {
                previousSlide.classList.add('future');
            }
        }

        slides.forEach((slide, index) => {
            slide.classList.remove('present', 'past', 'future');
            
            if (index < state.indexh) {
                slide.classList.add('past');
            } else if (index > state.indexh) {
                slide.classList.add('future');  
            } else {
                slide.classList.add('present');
            }
        });

        state.previousSlide = previousSlide;
        state.currentSlide = currentSlide;
    }

    function updateProgress() {
        if (progressBar && slides.length > 1) {
            const progress = (state.indexh / (slides.length - 1)) * 100;
            progressBar.style.width = progress + '%';
        }
    }

    function updateControls() {
        // 不需要更新右下角控制按鈕
        return;
    }

    function availableRoutes() {
        return {
            left: state.indexh > 0,
            right: state.indexh < slides.length - 1,
            up: false,
            down: false
        };
    }

    function navigateLeft() {
        if (state.indexh > 0) {
            slide(state.indexh - 1);
        }
    }

    function navigateRight() {
        if (state.indexh < slides.length - 1) {
            slide(state.indexh + 1);
        }
    }

    function navigateUp() {
        // For simplicity, treat up as left
        navigateLeft();
    }

    function navigateDown() {
        // For simplicity, treat down as right  
        navigateRight();
    }

    function next() {
        navigateRight();
    }

    function prev() {
        navigateLeft();
    }

    function sync() {
        slide(state.indexh, state.indexv);
    }

    function destroy() {
        document.removeEventListener('keydown', onDocumentKeyDown);
        
        if (dom.wrapper) {
            const controls = dom.wrapper.querySelector('.controls');
            const progress = dom.wrapper.querySelector('.progress');
            
            if (controls) controls.remove();
            if (progress) progress.remove();
        }
    }

    // Public API
    return {
        initialize: initialize,
        slide: slide,
        next: next,
        prev: prev,
        sync: sync,
        destroy: destroy,
        getCurrentSlide: () => state.currentSlide,
        getIndices: () => ({ h: state.indexh, v: state.indexv }),
        getTotalSlides: () => slides.length
    };
};

// Global constructor
window.Reveal.initialize = function(options) {
    return new window.Reveal(options).initialize();
};