/* ============================================================
   Grand Stay Hotels – Booking Dashboard
   ICS 128 – Final Project

   Description:
     A hotel booking dashboard that lets users:
       1. View all hotel locations on an interactive Leaflet map
       2. See their own location on the map (Geolocation API)
       3. Click a hotel to load its details and current weather
       4. Browse, filter, and sort rooms for the selected hotel
       5. Add rooms to a cart (stored in localStorage)
       6. Complete a checkout with full form validation

   Files used:
     public/hotels.json  – 12 hotel locations
     public/rooms.json   – 36 rooms (3 per hotel)
     scripts/project.js  – this file
============================================================ */


// ================================================================
// SECTION 1: CONFIGURATION
// ================================================================

// Get your FREE API key at https://www.weatherapi.com/
// After signing up, go to My Account and copy the key shown there.
// Replace the string below with your actual key.
const WEATHER_API_KEY = 'a423111efe2b412b96083158260404';   // <-- REPLACE THIS

// Tax rate applied at checkout (13% HST)
const TAX_RATE = 0.13;

// Extra fee added per room per night when it is raining or snowing
const WEATHER_FEE_PER_ROOM = 20;

// Discount applied when the guest books 3 or more nights
const MULTI_NIGHT_DISCOUNT_RATE = 0.10;   // 10%


// ================================================================
// SECTION 2: GLOBAL STATE VARIABLES
// ================================================================

// let is used here because all of these values change during the session

let map;                   // Leaflet map instance – set up in initMap()
let hotelsData = [];       // Array of hotel objects loaded from hotels.json
let roomsData  = [];       // Array of room objects loaded from rooms.json
let activeHotel = null;    // The hotel object the user has currently selected (or null)
let cart = [];             // Array of room objects in the booking cart
let weatherFeeActive = false;  // true when rain/snow is detected at the active hotel


// ================================================================
// SECTION 3: DOCUMENT READY
// Runs once the page has fully loaded. This is the entry point.
// ================================================================

$(document).ready(function () {

    // Set up the Leaflet map
    initMap();

    // Fetch hotels.json and rooms.json
    loadData();

    // Load any cart items saved from a previous session
    loadCartFromStorage();

    // Attach event listeners for filter dropdowns and checkboxes
    setupFilterListeners();

    // Attach event listeners for cart actions
    setupCartListeners();

    // Attach event listeners for checkout
    setupCheckoutListeners();

    // Recalculate the order summary live whenever nights or guests changes
    $('#field-nights, #field-guests').on('input', function () {
        updateOrderSummary();
    });

});


// ================================================================
// SECTION 4: MAP SETUP
// ================================================================

/**
 * initMap()
 * Creates the Leaflet map and adds the OpenStreetMap tile layer.
 * Then calls getUserLocation() to place the user on the map.
 */
function initMap() {
    // Create the map centered roughly in the middle of the world
    map = L.map('map').setView([25, 10], 2);

    // Add OpenStreetMap tiles (free, no API key needed)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(map);

    // Attempt to show the user's own location on the map
    getUserLocation();
}


/**
 * getUserLocation()
 * Uses the browser's built-in Geolocation API to find the user's
 * current position and places a blue "You are here" marker on the map.
 *
 * Note: this may require HTTPS or a browser permission prompt.
 */
function getUserLocation() {

    // Check that the browser supports geolocation before trying
    if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser.');
        return;
    }

    // Ask the browser for the user's position
    navigator.geolocation.getCurrentPosition(

        // Success callback: position is available
        function (position) {
            // Destructure the coordinates from the position object
            const { latitude, longitude } = position.coords;

            // Build a custom blue "dot" icon using Font Awesome
            const userIcon = L.divIcon({
                html: '<i class="fas fa-circle-dot" style="color:#0d6efd; font-size:22px; filter: drop-shadow(0 0 4px rgba(13,110,253,0.6));"></i>',
                className: 'hotel-marker-icon',
                iconSize:   [22, 22],
                iconAnchor: [11, 11]
            });

            // Place the marker on the map with a popup
            L.marker([latitude, longitude], { icon: userIcon })
                .addTo(map)
                .bindPopup('<strong><i class="fas fa-location-dot text-primary"></i> You are here</strong>')
                .openPopup();
        },

        // Error callback: could not get location (user denied, timeout, etc.)
        function (error) {
            console.warn('Geolocation error:', error.message);
            // The map still works without this – it is not a critical feature
        }

    );
}


// ================================================================
// SECTION 5: DATA LOADING (Fetch API)
// ================================================================

/**
 * loadData()
 * Fetches hotels.json and rooms.json from the public/ folder
 * using the modern Fetch API. Uses async/await and try/catch/finally
 * for clean error handling.
 */
async function loadData() {

    try {

        // Fetch both files at the same time using Promise.all for efficiency
        const [hotelsRes, roomsRes] = await Promise.all([
            fetch('public/hotels.json'),
            fetch('public/rooms.json')
        ]);

        // Check HTTP status of each response and throw a meaningful error if needed
        if (!hotelsRes.ok) {
            throw new Error('Could not load hotels.json. Make sure the file is in the public/ folder.');
        }
        if (!roomsRes.ok) {
            throw new Error('Could not load rooms.json. Make sure the file is in the public/ folder.');
        }

        // Parse the JSON body from each response
        // Destructuring the JSON arrays directly into our global variables
        hotelsData = await hotelsRes.json();
        roomsData  = await roomsRes.json();

        console.log(`Data loaded: ${hotelsData.length} hotels, ${roomsData.length} rooms.`);

        // Now that data is available, place hotel markers on the map
        addHotelMarkersToMap(hotelsData);

    } catch (error) {

        // Something went wrong – show the user a friendly error message
        console.error('Data load error:', error.message);

        $('#welcome-section').html(`
            <div class="alert alert-danger text-start">
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>Error loading data:</strong> ${error.message}
            </div>
        `);

    } finally {

        // This block always runs, whether there was an error or not.
        // Useful for hiding loading spinners, logging, cleanup, etc.
        console.log('loadData() finished.');

    }
}


// ================================================================
// SECTION 6: MAP MARKERS
// ================================================================

/**
 * addHotelMarkersToMap(hotels)
 * Loops through the hotels array and adds a custom marker for each location.
 * Each marker opens a popup with a "View Rooms" button that calls selectHotel().
 *
 * @param {Array} hotels - Array of hotel objects from hotels.json
 */
function addHotelMarkersToMap(hotels) {

    // Create a custom hotel icon using a Font Awesome icon rendered inside a divIcon
    const hotelIcon = L.divIcon({
        html: '<i class="fas fa-hotel" style="color:#d4a017; font-size:28px; filter: drop-shadow(1px 2px 3px rgba(0,0,0,0.4));"></i>',
        className: 'hotel-marker-icon',
        iconSize:    [28, 28],
        iconAnchor:  [14, 28],
        popupAnchor: [0, -28]
    });

    // Loop through every hotel object and place it on the map
    for (const hotel of hotels) {

        // Create a marker at this hotel's latitude and longitude
        const marker = L.marker([hotel.lat, hotel.lng], { icon: hotelIcon });

        // Attach a popup with hotel name, location, rating, and a "View Rooms" button.
        // The onclick calls selectHotel() with this hotel's id.
        marker.bindPopup(`
            <div style="min-width: 190px;">
                <strong class="d-block mb-1">${hotel.name}</strong>
                <small class="text-muted">
                    <i class="fas fa-map-marker-alt me-1"></i>${hotel.city}, ${hotel.country}
                </small><br>
                <small>
                    <i class="fas fa-star text-warning me-1"></i>${hotel.rating} / 5
                </small>
                <div class="mt-2">
                    <button class="btn btn-sm btn-primary w-100"
                            onclick="selectHotel(${hotel.id})">
                        <i class="fas fa-door-open me-1"></i>View Rooms
                    </button>
                </div>
            </div>
        `);

        marker.addTo(map);
    }
}


// ================================================================
// SECTION 7: HOTEL SELECTION
// ================================================================

/**
 * selectHotel(hotelId)
 * Called when the user clicks a hotel popup button or marker.
 * Sets the active hotel, pans the map, fetches weather, and shows rooms.
 *
 * @param {number} hotelId - The id of the hotel that was selected
 */
function selectHotel(hotelId) {

    try {

        // Use Array .find() to locate the hotel object with the matching id
        const hotel = hotelsData.find(function (h) {
            return h.id === hotelId;
        });

        // If the id doesn't match anything, throw an error
        if (!hotel) {
            throw new Error(`Hotel with id "${hotelId}" was not found in the data.`);
        }

        // Store the selected hotel in the global activeHotel variable
        activeHotel = hotel;

        // Smoothly fly the map to this hotel's location
        map.flyTo([hotel.lat, hotel.lng], 13, { duration: 1.5 });

        // Update the hotel details card on the page
        displayHotelInfo(hotel);

        // Fetch weather for this hotel's city (async, runs in background)
        getWeather(hotel.city);

        // Show the hotel rooms for this hotel
        displayRooms(hotel.id);

        // Fade out the welcome message and fade in the hotel + rooms sections
        // This is a jQuery animation
        $('#welcome-section').fadeOut(300, function () {
            $('#hotel-section').fadeIn(400);
            $('#rooms-section').fadeIn(400);
        });

        // Smoothly scroll the page down to the hotel info section
        $('html, body').animate({
            scrollTop: $('#hotel-section').offset().top - 75
        }, 600);

    } catch (error) {
        // Log the error and show a brief alert to the user
        console.error('selectHotel error:', error.message);
        alert('Could not load that hotel. Please try again.');
    }
}


/**
 * displayHotelInfo(hotel)
 * Populates the hotel info card with data from the selected hotel object.
 * Uses jQuery to update the DOM.
 *
 * @param {Object} hotel - The hotel object to display
 */
function displayHotelInfo(hotel) {

    // Destructure the fields we need from the hotel object
    const { name, city, country, rating, description } = hotel;

    // Update text content using jQuery .text() (safe against XSS)
    $('#hotel-name').text(name);
    $('#hotel-rating-value').text(rating);
    $('#hotel-location').text(`${city}, ${country}`);
    $('#hotel-description').text(description);
}


// ================================================================
// SECTION 8: WEATHER
// ================================================================

/**
 * getWeather(city)
 * Fetches the current weather for a city using the WeatherAPI.com API.
 * If it is raining or snowing, a weather service fee is applied.
 * Uses async/await and try/catch/finally.
 *
 * @param {string} city - The city name to look up
 */
async function getWeather(city) {

    // Show a loading spinner in the weather widget while we wait
    $('#weather-content').html(`
        <div class="spinner-border text-light mt-2" role="status">
            <span class="visually-hidden">Loading weather...</span>
        </div>
        <p class="mt-2 small">Loading weather...</p>
    `);

    // Reset the weather fee from any previous hotel selection
    weatherFeeActive = false;
    $('#weather-fee-alert').addClass('d-none');

    try {

        // If the user hasn't replaced the placeholder key, skip the API call
        if (WEATHER_API_KEY === 'your_api_key_here') {
            throw new Error('no_key');
        }

        // Build the API request URL
        const url = `https://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(city)}`;

        // Make the API call
        const response = await fetch(url);

        // If the server returned an error code, throw so we go to catch
        if (!response.ok) {
            throw new Error(`Weather API returned status ${response.status} for "${city}".`);
        }

        // Parse the weather JSON
        const data = await response.json();

        // Destructure the fields we want from the nested response object
        const { temp_c, feelslike_c, humidity, wind_kph, condition } = data.current;
        const conditionText = condition.text;
        const conditionIcon = 'https:' + condition.icon;   // icon URL starts without protocol

        // Check if the weather is bad (rain, snow, sleet, drizzle)
        // Using a conditional + .includes() to inspect the condition text
        const badWeatherWords = ['rain', 'snow', 'sleet', 'drizzle', 'blizzard', 'freezing'];
        let isBadWeather = false;

        for (const word of badWeatherWords) {
            if (conditionText.toLowerCase().includes(word)) {
                isBadWeather = true;
                break;   // No need to keep checking once we find a match
            }
        }

        if (isBadWeather) {
            weatherFeeActive = true;
            // Show the alert with a jQuery slide-down animation
            $('#weather-fee-alert').removeClass('d-none').hide().slideDown(400);
        }

        // Render the weather data in the widget using jQuery .html()
        $('#weather-content').html(`
            <img src="${conditionIcon}" alt="${conditionText}" style="width: 60px;">
            <div class="display-6 fw-bold mb-0">${Math.round(temp_c)}&deg;C</div>
            <p class="mb-1">${conditionText}</p>
            <small>
                <i class="fas fa-thermometer-half me-1"></i>Feels like ${Math.round(feelslike_c)}&deg;C
                &nbsp;&bull;&nbsp;
                <i class="fas fa-droplet me-1"></i>${humidity}%
                &nbsp;&bull;&nbsp;
                <i class="fas fa-wind me-1"></i>${wind_kph} km/h
            </small>
        `);

    } catch (error) {

        // Handle the "no API key" case with a helpful message
        if (error.message === 'no_key') {
            $('#weather-content').html(`
                <i class="fas fa-key fa-2x mb-2 mt-2"></i>
                <p class="small mb-0">
                    Weather API key not configured.<br>
                    Get a <a href="https://www.weatherapi.com/" target="_blank" class="text-white fw-bold">free key here</a>
                    and add it to project.js.
                </p>
            `);
        } else {
            // General API / network error
            console.error('Weather error:', error.message);
            $('#weather-content').html(`
                <i class="fas fa-cloud-slash fa-2x mb-2 mt-2"></i>
                <p class="small mb-0">Could not load weather for ${city}.</p>
            `);
        }

    } finally {

        // Always refresh the order summary after weather state changes,
        // so the weather fee appears (or disappears) in the price breakdown.
        updateOrderSummary();

    }
}


// ================================================================
// SECTION 9: ROOM DISPLAY, FILTERING, AND SORTING
// ================================================================

/**
 * displayRooms(hotelId)
 * Filters roomsData to rooms whose hotelId matches the selected hotel,
 * applies any active filter/sort settings, then calls renderRoomCards().
 *
 * @param {number} hotelId - The id of the currently active hotel
 */
function displayRooms(hotelId) {

    // Start with all rooms belonging to this hotel
    // .filter() returns a new array – it does not modify the original
    let filtered = roomsData.filter(function (room) {
        return room.hotelId === hotelId;
    });

    // Apply room type filter (Suite, Deluxe, Standard, or "all")
    const selectedType = $('#filter-type').val();
    if (selectedType !== 'all') {
        filtered = filtered.filter(function (room) {
            return room.type === selectedType;
        });
    }

    // Apply "available only" checkbox filter
    if ($('#filter-available').is(':checked')) {
        filtered = filtered.filter(function (room) {
            return room.available === true;
        });
    }

    // Apply sort order using a conditional chain
    const sortBy = $('#sort-by').val();

    if (sortBy === 'price-asc') {
        filtered.sort((a, b) => a.pricePerNight - b.pricePerNight);

    } else if (sortBy === 'price-desc') {
        filtered.sort((a, b) => b.pricePerNight - a.pricePerNight);

    } else if (sortBy === 'rating') {
        filtered.sort((a, b) => b.rating - a.rating);

    } else if (sortBy === 'guests') {
        filtered.sort((a, b) => b.maxGuests - a.maxGuests);
    }

    // Render the filtered and sorted rooms to the page
    renderRoomCards(filtered);

    // Update the "X room(s) found" label
    $('#rooms-count-label').text(`${filtered.length} room(s) found`);
}


/**
 * renderRoomCards(rooms)
 * Builds Bootstrap card HTML for each room in the array and
 * injects them all into the #rooms-container element.
 *
 * @param {Array} rooms - Array of room objects to display
 */
function renderRoomCards(rooms) {

    const container = $('#rooms-container');

    // Clear any cards from the previous hotel or filter state
    container.empty();

    // Show a message and stop if there are no rooms to display
    if (rooms.length === 0) {
        $('#no-rooms-msg').removeClass('d-none');
        return;
    }

    $('#no-rooms-msg').addClass('d-none');

    // Loop through each room object and build its card HTML
    for (const room of rooms) {

        // Look up the hotel this room belongs to (for displaying hotel name)
        const hotel = hotelsData.find(h => h.id === room.hotelId);
        const hotelName = hotel ? hotel.name : 'Unknown Hotel';

        // Decide the availability badge and whether the Book button is enabled
        const availBadge = room.available
            ? '<span class="badge bg-success">Available</span>'
            : '<span class="badge bg-secondary">Unavailable</span>';

        const bookButton = room.available
            ? `<button class="btn btn-primary btn-sm w-100 book-btn" data-room-id="${room.id}">
                   <i class="fas fa-plus-circle me-1"></i>Book Room
               </button>`
            : `<button class="btn btn-secondary btn-sm w-100" disabled>
                   <i class="fas fa-ban me-1"></i>Unavailable
               </button>`;

        // Pick a badge colour based on room type using conditionals
        let typeBadgeClass = 'bg-info text-dark';
        if (room.type === 'Suite')    typeBadgeClass = 'bg-warning text-dark';
        if (room.type === 'Standard') typeBadgeClass = 'bg-secondary';

        // Build the card HTML string
        const cardHtml = `
            <div class="col-sm-6 col-xl-4">
                <div class="card room-card shadow-sm h-100">
                    <img src="${room.image}"
                         class="card-img-top"
                         alt="${room.name}"
                         onerror="this.src='https://picsum.photos/seed/room${room.id}/600/400'">
                    <div class="card-body d-flex flex-column">

                        <!-- Room name + type badge -->
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title mb-0 fw-bold">${room.name}</h6>
                            <span class="badge ${typeBadgeClass} ms-2 text-nowrap">${room.type}</span>
                        </div>

                        <!-- Hotel name -->
                        <p class="text-muted small mb-2">
                            <i class="fas fa-hotel me-1"></i>${hotelName}
                        </p>

                        <!-- Room details list -->
                        <ul class="list-unstyled small mb-3">
                            <li><i class="fas fa-bed me-2 text-primary"></i>${room.beds}</li>
                            <li><i class="fas fa-users me-2 text-primary"></i>Up to ${room.maxGuests} guests</li>
                            <li><i class="fas fa-star me-2 text-warning"></i>${room.rating} / 5</li>
                        </ul>

                        <!-- Price + availability -->
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <strong class="text-primary fs-5">
                                $${room.pricePerNight}
                                <span class="text-muted fw-normal fs-6">/night</span>
                            </strong>
                            ${availBadge}
                        </div>

                        <!-- Book button pinned to the bottom of the card -->
                        <div class="mt-auto">
                            ${bookButton}
                        </div>

                    </div>
                </div>
            </div>
        `;

        // Append this card to the container using jQuery
        container.append(cardHtml);
    }

    // Fade in the cards with a jQuery animation
    container.hide().fadeIn(500);
}


/**
 * setupFilterListeners()
 * Attaches change event handlers to the filter/sort controls so
 * the room list updates whenever the user changes a setting.
 */
function setupFilterListeners() {
    $('#filter-type, #sort-by, #filter-available').on('change', function () {
        // Only re-render if a hotel has actually been selected
        if (activeHotel) {
            displayRooms(activeHotel.id);
        }
    });
}


// ================================================================
// SECTION 10: BOOKING CART
// ================================================================

/**
 * setupCartListeners()
 * Uses jQuery event delegation to attach click listeners for
 * "Book Room" buttons and "Remove" buttons.
 * Delegation means it works even on elements added to the DOM later.
 */
function setupCartListeners() {

    // "Book Room" – button is dynamically added to the page, so use delegation
    $(document).on('click', '.book-btn', function () {
        const roomId = parseInt($(this).data('room-id'));
        addToCart(roomId);
    });

    // "Remove item" – also dynamically added, so also use delegation
    $(document).on('click', '.remove-cart-item', function () {
        const roomId = parseInt($(this).data('room-id'));
        removeFromCart(roomId);
    });

    // "Empty Cart" button
    $('#clear-cart-btn').on('click', function () {
        if (confirm('Are you sure you want to remove all items from your cart?')) {
            clearCart();
        }
    });
}


/**
 * addToCart(roomId)
 * Finds the room by its id, checks it isn't already in the cart,
 * then adds it and saves to localStorage.
 *
 * @param {number} roomId - The id of the room to add
 */
function addToCart(roomId) {

    try {

        // Find the room in our loaded data
        const room = roomsData.find(r => r.id === roomId);

        if (!room) {
            throw new Error(`Room id ${roomId} not found.`);
        }

        // Check if this room is already in the cart using .some()
        const alreadyAdded = cart.some(r => r.id === roomId);

        if (alreadyAdded) {
            showToast('This room is already in your cart.', 'warning');
            return;   // Stop here – no duplicate entries
        }

        // Add to the cart array
        cart.push(room);

        // Persist to localStorage and re-render the cart
        saveCartToStorage();
        renderCart();

        // Give the user positive feedback
        showToast(`"${room.name}" added to your cart!`, 'success');

    } catch (error) {
        console.error('addToCart error:', error.message);
    }
}


/**
 * removeFromCart(roomId)
 * Removes the room with the given id from the cart array.
 *
 * @param {number} roomId - The id of the room to remove
 */
function removeFromCart(roomId) {
    // .filter() creates a new array without the unwanted item
    cart = cart.filter(room => room.id !== roomId);
    saveCartToStorage();
    renderCart();
}


/**
 * clearCart()
 * Empties the cart completely.
 */
function clearCart() {
    cart = [];
    saveCartToStorage();
    renderCart();
}


/**
 * saveCartToStorage()
 * Converts the cart array to a JSON string and saves it in
 * localStorage. This way the cart survives page refreshes.
 */
function saveCartToStorage() {
    localStorage.setItem('grandstay_cart', JSON.stringify(cart));
    updateCartBadge();
}


/**
 * loadCartFromStorage()
 * Called on page load. Reads a previously saved cart from
 * localStorage and restores it into the cart array.
 */
function loadCartFromStorage() {
    const saved = localStorage.getItem('grandstay_cart');

    if (saved) {
        try {
            cart = JSON.parse(saved);   // Deconstruct the JSON string back into an array
            renderCart();
        } catch (parseError) {
            // If the data in storage is corrupt, just start fresh
            console.warn('Could not parse saved cart – starting with empty cart.');
            cart = [];
        }
    }
}


/**
 * renderCart()
 * Rebuilds the offcanvas cart HTML from the current cart array.
 * Uses jQuery for all DOM manipulation.
 */
function renderCart() {

    const cartItems = $('#cart-items');
    cartItems.empty();

    // Update the nav badge to show current count
    updateCartBadge();

    // If the cart is empty, show the empty-state message and hide the footer
    if (cart.length === 0) {
        cartItems.html(`
            <p class="text-muted text-center mt-4">
                <i class="fas fa-bed fa-2x mb-2 d-block text-secondary"></i>
                Your cart is empty.<br>
                Browse rooms and click <strong>Book Room</strong> to add items.
            </p>
        `);
        $('#cart-footer').addClass('d-none');
        return;
    }

    // Cart has items – show the footer with subtotal and action buttons
    $('#cart-footer').removeClass('d-none');

    // Calculate the per-night subtotal while looping through the cart
    let perNightSubtotal = 0;

    for (const room of cart) {

        // Find the hotel name for this room
        const hotel = hotelsData.find(h => h.id === room.hotelId);
        const hotelName = hotel ? hotel.name : 'Unknown Hotel';

        perNightSubtotal += room.pricePerNight;

        // Build one cart item row
        const itemHtml = `
            <div class="d-flex align-items-center mb-3 pb-3 border-bottom">
                <img src="${room.image}"
                     alt="${room.name}"
                     style="width: 62px; height: 50px; object-fit: cover; border-radius: 6px;"
                     onerror="this.src='https://picsum.photos/seed/room${room.id}/62/50'">
                <div class="ms-2 flex-grow-1 overflow-hidden">
                    <div class="fw-semibold small text-truncate">${room.name}</div>
                    <div class="text-muted" style="font-size: 0.72rem;">${hotelName}</div>
                    <div class="text-primary fw-bold small">$${room.pricePerNight}/night</div>
                </div>
                <button class="btn btn-sm btn-outline-danger remove-cart-item ms-2 flex-shrink-0"
                        data-room-id="${room.id}"
                        title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        cartItems.append(itemHtml);
    }

    // Show the per-night subtotal
    $('#cart-subtotal').text(`$${perNightSubtotal.toFixed(2)}`);
}


/**
 * updateCartBadge()
 * Updates the red badge on the navbar cart button to show how
 * many items are currently in the cart.
 */
function updateCartBadge() {
    const count = cart.length;
    const badge = $('#cart-count');

    badge.text(count);

    // Hide the badge entirely when cart is empty
    if (count === 0) {
        badge.addClass('d-none');
    } else {
        badge.removeClass('d-none');
    }
}


// ================================================================
// SECTION 11: CHECKOUT, FORM VALIDATION, AND ORDER SUMMARY
// ================================================================

/**
 * setupCheckoutListeners()
 * Attaches event handlers for the checkout modal.
 * Uses document-level delegation so the confirm button always works
 * even when the footer HTML is swapped out after a successful booking.
 */
function setupCheckoutListeners() {

    // When the modal opens, reset the form and refresh the order summary
    $('#checkoutModal').on('show.bs.modal', function () {
        resetCheckoutForm();
        updateOrderSummary();
    });

    // "Confirm Booking" button – use delegation so it works after the footer is replaced
    $(document).on('click', '#confirm-booking-btn', function () {
        if (validateCheckoutForm()) {
            processCheckout();
        }
    });
}


/**
 * validateCheckoutForm()
 * Validates every form field using regex patterns.
 * Marks each field as valid or invalid and shows/hides error messages.
 * Returns true only if all fields pass.
 *
 * @returns {boolean} - true if the form is valid, false otherwise
 */
function validateCheckoutForm() {

    let allValid = true;

    // Clear all previous validation styles before re-checking
    $('.form-control').removeClass('is-valid is-invalid');

    // ---- Regex patterns for each field ----
    // Using const because these patterns do not change
    const patterns = {
        name:     /^[A-Za-z\s]{2,50}$/,           // Letters and spaces only, 2-50 chars
        email:    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,   // Standard email: user@domain.tld
        phone:    /^[\d\s\-\(\)\+]{7,20}$/,        // 7-20 digits, dashes, parens allowed
        address:  /^.{5,100}$/,                    // Any 5-100 characters
        city:     /^[A-Za-z\s\-]{2,50}$/,          // Letters, spaces, hyphens
        province: /^[A-Za-z\s]{2,30}$/,            // Letters and spaces
        postal:   /^[A-Za-z0-9\s\-]{3,10}$/        // 3-10 alphanumeric (covers postal + zip)
    };

    // ---- Run each field through its pattern ----

    const name = $('#field-name').val().trim();
    if (!patterns.name.test(name)) {
        markInvalid('name', 'Enter a valid full name (letters only, 2–50 characters).');
        allValid = false;
    } else {
        markValid('name');
    }

    const email = $('#field-email').val().trim();
    if (!patterns.email.test(email)) {
        markInvalid('email', 'Enter a valid email address (e.g. you@example.com).');
        allValid = false;
    } else {
        markValid('email');
    }

    const phone = $('#field-phone').val().trim();
    if (!patterns.phone.test(phone)) {
        markInvalid('phone', 'Enter a valid phone number (7–20 digits; dashes and spaces allowed).');
        allValid = false;
    } else {
        markValid('phone');
    }

    const address = $('#field-address').val().trim();
    if (!patterns.address.test(address)) {
        markInvalid('address', 'Enter a valid street address (at least 5 characters).');
        allValid = false;
    } else {
        markValid('address');
    }

    const city = $('#field-city').val().trim();
    if (!patterns.city.test(city)) {
        markInvalid('city', 'Enter a valid city name.');
        allValid = false;
    } else {
        markValid('city');
    }

    const province = $('#field-province').val().trim();
    if (!patterns.province.test(province)) {
        markInvalid('province', 'Enter a valid province or state.');
        allValid = false;
    } else {
        markValid('province');
    }

    const postal = $('#field-postal').val().trim();
    if (!patterns.postal.test(postal)) {
        markInvalid('postal', 'Enter a valid postal or zip code (3–10 characters).');
        allValid = false;
    } else {
        markValid('postal');
    }

    // Number of nights: must be a whole number between 1 and 30
    const nights = parseInt($('#field-nights').val());
    if (isNaN(nights) || nights < 1 || nights > 30) {
        markInvalid('nights', 'Enter a number of nights between 1 and 30.');
        allValid = false;
    } else {
        markValid('nights');
    }

    // Number of guests: must be a whole number between 1 and 10
    const guests = parseInt($('#field-guests').val());
    if (isNaN(guests) || guests < 1 || guests > 10) {
        markInvalid('guests', 'Enter a number of guests between 1 and 10.');
        allValid = false;
    } else {
        markValid('guests');
    }

    // Make sure the cart is not empty before allowing checkout
    if (cart.length === 0) {
        alert('Your cart is empty. Please add at least one room before checking out.');
        return false;
    }

    return allValid;
}


/**
 * markInvalid(fieldKey, message)
 * Adds Bootstrap's is-invalid class to an input and shows an error message.
 *
 * @param {string} fieldKey - Matches the suffix in the input id (e.g. "name" → #field-name)
 * @param {string} message  - The error message to display below the field
 */
function markInvalid(fieldKey, message) {
    $(`#field-${fieldKey}`).addClass('is-invalid').removeClass('is-valid');
    $(`#err-${fieldKey}`).text(message);
}


/**
 * markValid(fieldKey)
 * Adds Bootstrap's is-valid class to show a green checkmark.
 *
 * @param {string} fieldKey - Matches the suffix in the input id
 */
function markValid(fieldKey) {
    $(`#field-${fieldKey}`).addClass('is-valid').removeClass('is-invalid');
    $(`#err-${fieldKey}`).text('');
}


/**
 * updateOrderSummary()
 * Rebuilds the order summary panel in the checkout modal.
 * Called whenever: the modal opens, nights/guests change, or weather updates.
 *
 * Pricing rules:
 *   - Base: sum of room prices × number of nights
 *   - Weather fee: +$20 per room per night if rain/snow (weatherFeeActive)
 *   - Multi-night discount: -10% off subtotal if 3+ nights booked
 *   - Tax: +13% HST on the adjusted total
 */
function updateOrderSummary() {

    const nights = parseInt($('#field-nights').val()) || 1;
    const guests = parseInt($('#field-guests').val()) || 1;

    // --- Calculate each pricing component ---

    // Base subtotal: add up (price × nights) for each room in the cart
    let subtotal = 0;
    for (const room of cart) {
        subtotal += room.pricePerNight * nights;
    }

    // Multi-night discount (only applies if booking 3 or more nights)
    let discount = 0;
    if (nights >= 3) {
        discount = subtotal * MULTI_NIGHT_DISCOUNT_RATE;
    }

    // Weather fee (applies per room per night when rain/snow detected)
    let weatherFee = 0;
    if (weatherFeeActive) {
        weatherFee = WEATHER_FEE_PER_ROOM * cart.length * nights;
    }

    // Tax is applied on the adjusted amount (after discount, including weather fee)
    const adjustedSubtotal = subtotal - discount + weatherFee;
    const tax   = adjustedSubtotal * TAX_RATE;
    const total = adjustedSubtotal + tax;

    // --- Build the HTML for the summary panel ---

    let html = '';

    if (cart.length === 0) {
        // Cart is empty – show a placeholder message
        html = '<p class="text-muted mb-0">No rooms in cart yet.</p>';
    } else {

        // List each booked room with its line-item total
        html += '<ul class="list-group list-group-flush mb-3">';

        for (const room of cart) {
            const hotel = hotelsData.find(h => h.id === room.hotelId);
            const cityLabel = hotel ? hotel.city : '';
            const lineTotal = room.pricePerNight * nights;

            html += `
                <li class="list-group-item px-0 py-2 bg-transparent">
                    <div class="d-flex justify-content-between">
                        <span class="fw-semibold">${room.name}</span>
                        <span>$${lineTotal.toFixed(2)}</span>
                    </div>
                    <small class="text-muted">
                        ${cityLabel} &bull; $${room.pricePerNight}/night &times; ${nights} night${nights > 1 ? 's' : ''}
                    </small>
                </li>
            `;
        }

        html += '</ul>';

        // Subtotal row
        html += `
            <div class="d-flex justify-content-between mb-1">
                <span>Subtotal</span>
                <span>$${subtotal.toFixed(2)}</span>
            </div>
        `;

        // Discount row (only shown when applicable)
        if (discount > 0) {
            html += `
                <div class="d-flex justify-content-between mb-1 text-success">
                    <span><i class="fas fa-tag me-1"></i>3+ night discount (10%)</span>
                    <span>&minus;$${discount.toFixed(2)}</span>
                </div>
            `;
        }

        // Weather fee row (only shown when applicable)
        if (weatherFee > 0) {
            html += `
                <div class="d-flex justify-content-between mb-1 text-warning">
                    <span><i class="fas fa-cloud-rain me-1"></i>Weather service fee</span>
                    <span>+$${weatherFee.toFixed(2)}</span>
                </div>
            `;
        }

        // Tax and grand total
        html += `
            <hr class="my-2">
            <div class="d-flex justify-content-between mb-1 text-muted">
                <span>Tax (13% HST)</span>
                <span>$${tax.toFixed(2)}</span>
            </div>
            <div class="d-flex justify-content-between fw-bold fs-5">
                <span>Total</span>
                <span class="text-primary">$${total.toFixed(2)}</span>
            </div>
        `;

        // Tip about the multi-night discount if the user hasn't qualified yet
        if (nights < 3) {
            html += `
                <p class="text-muted small mt-2 mb-0">
                    <i class="fas fa-info-circle me-1 text-primary"></i>
                    Book <strong>3 or more nights</strong> to unlock a 10% discount!
                </p>
            `;
        }
    }

    // Inject the summary into the page using jQuery
    $('#order-summary').html(html);
}


/**
 * processCheckout()
 * Called after form validation passes.
 * Displays the booking confirmation and clears the cart.
 */
function processCheckout() {

    // Read the submitted values from the form
    const nights   = parseInt($('#field-nights').val());
    const guests   = parseInt($('#field-guests').val());
    const name     = $('#field-name').val().trim();
    const email    = $('#field-email').val().trim();
    const city     = $('#field-city').val().trim();
    const province = $('#field-province').val().trim();

    // Recalculate the final total for the confirmation display
    let subtotal = 0;
    for (const room of cart) {
        subtotal += room.pricePerNight * nights;
    }
    const discount   = nights >= 3 ? subtotal * MULTI_NIGHT_DISCOUNT_RATE : 0;
    const weatherFee = weatherFeeActive ? WEATHER_FEE_PER_ROOM * cart.length * nights : 0;
    const adjusted   = subtotal - discount + weatherFee;
    const tax        = adjusted * TAX_RATE;
    const total      = adjusted + tax;

    // Build a list of the booked rooms for the confirmation
    let roomListHtml = '<ul class="mb-2">';
    for (const room of cart) {
        roomListHtml += `<li>${room.name} &mdash; $${room.pricePerNight}/night</li>`;
    }
    roomListHtml += '</ul>';

    // Build the full confirmation details HTML
    const confirmHtml = `
        <p class="mb-1"><strong>Guest Name:</strong> ${name}</p>
        <p class="mb-1"><strong>Email:</strong> ${email}</p>
        <p class="mb-1"><strong>Location:</strong> ${city}, ${province}</p>
        <p class="mb-2"><strong>Stay:</strong> ${nights} night${nights > 1 ? 's' : ''} &bull; ${guests} guest${guests > 1 ? 's' : ''}</p>
        <strong>Rooms Booked:</strong>
        ${roomListHtml}
        <hr>
        <p class="mb-0 fs-5">
            <strong>Total Charged:</strong>
            <span class="text-primary fw-bold">$${total.toFixed(2)}</span>
        </p>
    `;

    // Hide the booking form and slide in the confirmation using jQuery animations
    $('#booking-form-section').fadeOut(300, function () {
        $('#confirmation-details').html(confirmHtml);
        $('#confirmation-section').fadeIn(400);
    });

    // Swap the footer buttons: remove Cancel/Confirm, show a Done button
    $('#checkout-modal-footer').html(`
        <button type="button" class="btn btn-success fw-bold px-4" data-bs-dismiss="modal">
            <i class="fas fa-check me-2"></i>Done
        </button>
    `);

    // Clear the cart after a successful booking
    clearCart();
}


/**
 * resetCheckoutForm()
 * Resets the checkout modal to its initial state.
 * Called each time the modal opens so previous data doesn't show.
 */
function resetCheckoutForm() {

    // Remove all Bootstrap validation classes
    $('.form-control').removeClass('is-valid is-invalid');

    // Show the form, hide the confirmation section
    $('#booking-form-section').show();
    $('#confirmation-section').hide();

    // Restore the original footer buttons
    $('#checkout-modal-footer').html(`
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
            Cancel
        </button>
        <button type="button" class="btn btn-warning fw-bold" id="confirm-booking-btn">
            <i class="fas fa-check me-2"></i>Confirm Booking
        </button>
    `);
}


// ================================================================
// SECTION 12: UTILITY FUNCTIONS
// ================================================================

/**
 * showToast(message, type)
 * Displays a small Bootstrap toast notification at the bottom-right
 * of the screen. Used to give meaningful feedback to the user.
 *
 * @param {string} message - The text to show in the toast
 * @param {string} type    - 'success', 'warning', or 'danger'
 */
function showToast(message, type) {

    // Remove any toast that is already showing
    $('#app-toast').remove();

    // Map each type to a Bootstrap background class
    const bgClasses = {
        success: 'bg-success text-white',
        warning: 'bg-warning text-dark',
        danger:  'bg-danger text-white'
    };

    // Use 'success' styling as a fallback if an unknown type is passed
    const bgClass = bgClasses[type] || bgClasses['success'];

    // Build the toast element HTML
    const toastHtml = `
        <div id="app-toast"
             class="toast align-items-center ${bgClass} border-0 position-fixed bottom-0 end-0 m-3"
             role="alert"
             style="z-index: 9999;">
            <div class="d-flex">
                <div class="toast-body fw-semibold">${message}</div>
                <button type="button"
                        class="btn-close ${type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto"
                        data-bs-dismiss="toast"
                        aria-label="Close"></button>
            </div>
        </div>
    `;

    // Add the toast to the body and display it using the Bootstrap Toast component
    $('body').append(toastHtml);
    const toastEl = document.getElementById('app-toast');
    const toast   = new bootstrap.Toast(toastEl, { delay: 3000 });
    toast.show();
}
