// Secret words by category. Everyone but the imposter sees one; the imposter may see its category.
// A good word has several angles to clue from (Pizza: slice, delivery, Friday, Italy) and nobody at the table
// has to ask what it means. `pairs` feed Close Word mode: the crew gets one word, the imposter the other, so both
// should share most of their clues and split on a few (Beach and Pool: towels and sun, but sand or chlorine).

export const CATEGORIES = {
  food: {
    label: 'Food',
    words: [
      'Pizza', 'Sushi', 'Tacos', 'Burger', 'Pancakes', 'Ramen', 'Ice Cream', 'Popcorn', 'Spaghetti', 'Burrito',
      'Dumplings', 'Croissant', 'Cheesecake', 'Hot Dog', 'Bagel', 'Waffles', 'Fried Chicken', 'Curry', 'Nachos', 'Donut',
      'Steak', 'Lasagna', 'Mac and Cheese', 'Avocado Toast', 'Boba', 'Cereal', 'Pretzel', 'Grilled Cheese', 'Lobster', 'French Fries',
      'Birthday Cake', 'Peanut Butter', 'Watermelon', 'Fondue', 'Cotton Candy', 'Hot Sauce', "S'mores", 'Garlic Bread', 'Chicken Nuggets', 'Banana',
      'Coffee', 'Gummy Bears',
    ],
    pairs: [
      ['Pancakes', 'Waffles'], ['Ketchup', 'Mustard'], ['Coffee', 'Tea'], ['Burger', 'Hot Dog'], ['Ice Cream', 'Frozen Yogurt'],
      ['Donut', 'Bagel'], ['Tacos', 'Burritos'], ['Croissant', 'Baguette'], ['Cupcake', 'Muffin'], ['Spaghetti', 'Ramen'],
      ['French Fries', 'Onion Rings'], ['Lobster', 'Crab'], ['Lemonade', 'Iced Tea'], ['Peanut Butter', 'Nutella'], ['Cereal', 'Oatmeal'],
      ['Strawberry', 'Cherry'], ['Honey', 'Maple Syrup'], ['Mac and Cheese', 'Grilled Cheese'], ['Popcorn', 'Nachos'], ['Fried Chicken', 'Chicken Nuggets'],
    ],
  },
  animals: {
    label: 'Animals',
    words: [
      'Dog', 'Cat', 'Elephant', 'Penguin', 'Giraffe', 'Shark', 'Dolphin', 'Kangaroo', 'Owl', 'Lion',
      'Panda', 'Koala', 'Octopus', 'Flamingo', 'Horse', 'Snake', 'Frog', 'Bat', 'Bee', 'Eagle',
      'Turtle', 'Rabbit', 'Squirrel', 'Zebra', 'Monkey', 'Crocodile', 'Hamster', 'Jellyfish', 'Peacock', 'Sloth',
      'Wolf', 'Polar Bear', 'Camel', 'Parrot', 'Goldfish', 'Raccoon', 'Chicken', 'Spider', 'Whale', 'Pigeon',
      'Mosquito', 'Skunk',
    ],
    pairs: [
      ['Lion', 'Tiger'], ['Shark', 'Dolphin'], ['Cat', 'Dog'], ['Horse', 'Zebra'], ['Bee', 'Wasp'],
      ['Owl', 'Bat'], ['Penguin', 'Polar Bear'], ['Butterfly', 'Moth'], ['Monkey', 'Gorilla'], ['Turtle', 'Snail'],
      ['Mouse', 'Rat'], ['Wolf', 'Fox'], ['Camel', 'Llama'], ['Koala', 'Panda'], ['Octopus', 'Jellyfish'],
      ['Chicken', 'Duck'], ['Sheep', 'Goat'], ['Flamingo', 'Peacock'],
    ],
  },
  places: {
    label: 'Places',
    words: [
      'Beach', 'Airport', 'Hospital', 'Library', 'Movie Theater', 'Gym', 'Casino', 'Zoo', 'Museum', 'Supermarket',
      'Wedding', 'Cruise Ship', 'Ski Resort', 'Haunted House', 'Space Station', 'Submarine', 'Farm', 'Amusement Park', 'Coffee Shop', 'Prison',
      'Campsite', 'Nightclub', 'Train Station', 'Hotel', 'Stadium', 'Bank', 'Classroom', 'Laundromat', 'Aquarium', 'Fire Station',
      'Desert Island', 'Car Wash', 'Barbershop', 'Pirate Ship', 'Courtroom', 'Spa', 'IKEA', 'Gas Station', 'Elevator', 'Drive-Thru',
      'Water Park',
    ],
    pairs: [
      ['Beach', 'Pool'], ['Airport', 'Train Station'], ['Library', 'Bookstore'], ['Zoo', 'Aquarium'], ['Museum', 'Art Gallery'],
      ['Hotel', 'Hostel'], ['Nightclub', 'Karaoke Bar'], ['Casino', 'Arcade'], ['Cruise Ship', 'Pirate Ship'], ['Prison', 'High School'],
      ['Haunted House', 'Cemetery'], ['Space Station', 'Submarine'], ['Barbershop', 'Nail Salon'], ['Courtroom', 'Classroom'], ['Laundromat', 'Car Wash'],
      ['Amusement Park', 'Water Park'], ['Coffee Shop', 'Bakery'], ['Hospital', 'Vet Clinic'], ['Gym', 'Yoga Studio'],
    ],
  },
  jobs: {
    label: 'Jobs',
    words: [
      'Doctor', 'Teacher', 'Firefighter', 'Chef', 'Pilot', 'Astronaut', 'Lawyer', 'Plumber', 'Barista', 'Dentist',
      'Magician', 'Lifeguard', 'Detective', 'Farmer', 'Mail Carrier', 'Photographer', 'DJ', 'Surgeon', 'Judge', 'Personal Trainer',
      'Influencer', 'Architect', 'Mechanic', 'Flight Attendant', 'Electrician', 'Zookeeper', 'Librarian', 'Taxi Driver', 'Wedding Planner', 'Software Engineer',
      'Nurse', 'Scientist', 'Actor', 'Hairdresser', 'Tattoo Artist', 'Clown', 'Waiter', 'Spy', 'Bartender', 'Babysitter',
      'Delivery Driver', 'Real Estate Agent', 'Police Officer',
    ],
    pairs: [
      ['Doctor', 'Nurse'], ['Chef', 'Baker'], ['Pilot', 'Flight Attendant'], ['Lawyer', 'Judge'], ['Firefighter', 'Police Officer'],
      ['Plumber', 'Electrician'], ['Barista', 'Bartender'], ['Magician', 'Clown'], ['Detective', 'Spy'], ['Teacher', 'Librarian'],
      ['Photographer', 'Influencer'], ['Actor', 'Singer'], ['Hairdresser', 'Tattoo Artist'], ['Taxi Driver', 'Bus Driver'], ['Lifeguard', 'Swim Coach'],
      ['Personal Trainer', 'Yoga Teacher'], ['DJ', 'Radio Host'], ['Zookeeper', 'Vet'], ['Architect', 'Builder'],
    ],
  },
  sports: {
    label: 'Sports and Games',
    words: [
      'Soccer', 'Basketball', 'Tennis', 'Golf', 'Rowing', 'Surfing', 'Skiing', 'Boxing', 'Baseball', 'Volleyball',
      'Bowling', 'Swimming', 'Chess', 'Poker', 'Badminton', 'Ping Pong', 'Hockey', 'Skateboarding', 'Yoga', 'Marathon',
      'Rock Climbing', 'Fencing', 'Wrestling', 'Archery', 'Cycling', 'Karate', 'Darts', 'Snowboarding', 'Figure Skating', 'Gymnastics',
      'Football', 'Cricket', 'Sumo', 'Mini Golf', 'Horse Racing', 'Pickleball', 'Dodgeball', 'Go Karts', 'Hide and Seek', 'Monopoly',
      'Jenga', 'Twister', 'Uno', 'Laser Tag', 'Tug of War',
    ],
    pairs: [
      ['Tennis', 'Badminton'], ['Football', 'Rugby'], ['Basketball', 'Volleyball'], ['Skiing', 'Snowboarding'], ['Surfing', 'Skateboarding'],
      ['Boxing', 'Wrestling'], ['Baseball', 'Cricket'], ['Golf', 'Mini Golf'], ['Ping Pong', 'Air Hockey'], ['Hockey', 'Figure Skating'],
      ['Chess', 'Checkers'], ['Poker', 'Blackjack'], ['Yoga', 'Pilates'], ['Darts', 'Archery'], ['Bowling', 'Curling'],
      ['Laser Tag', 'Paintball'], ['Hide and Seek', 'Tag'], ['Rowing', 'Kayaking'],
    ],
  },
  home: {
    label: 'Stuff',
    words: [
      'Toothbrush', 'Fridge', 'Couch', 'Pillow', 'Microwave', 'Mirror', 'TV Remote', 'Blender', 'Vacuum', 'Bathtub',
      'Toaster', 'Umbrella', 'Doorbell', 'Candle', 'Alarm Clock', 'Washing Machine', 'Coffee Mug', 'Frying Pan', 'Hair Dryer', 'Toilet Paper',
      'Laptop', 'Phone Charger', 'Houseplant', 'Trash Can', 'Scissors', 'Keys', 'Wallet', 'Sunglasses', 'Backpack', 'Headphones',
      'Smoke Alarm', 'Bunk Bed', 'Fish Tank', 'Duct Tape', 'Air Fryer', 'Hoodie', 'Flip Flops', 'Lighter', 'Socks', 'Shopping Cart',
      'Bubble Wrap', 'Rubber Duck', 'Selfie Stick',
    ],
    pairs: [
      ['Couch', 'Bed'], ['Pillow', 'Blanket'], ['Microwave', 'Oven'], ['Toothbrush', 'Hairbrush'], ['TV Remote', 'Game Controller'],
      ['Vacuum', 'Broom'], ['Bathtub', 'Shower'], ['Umbrella', 'Raincoat'], ['Candle', 'Flashlight'], ['Washing Machine', 'Dishwasher'],
      ['Coffee Mug', 'Wine Glass'], ['Hair Dryer', 'Leaf Blower'], ['Toilet Paper', 'Paper Towels'], ['Laptop', 'Tablet'], ['Sunglasses', 'Glasses'],
      ['Backpack', 'Suitcase'], ['Socks', 'Gloves'], ['Flip Flops', 'Slippers'], ['Duct Tape', 'Glue'], ['Lighter', 'Matches'],
    ],
  },
  screen: {
    label: 'Movies and TV',
    words: [
      'Titanic', 'Jaws', 'Frozen', 'Star Wars', 'Harry Potter', 'Toy Story', 'The Lion King', 'Jurassic Park', 'Shrek', 'The Avengers',
      'Finding Nemo', 'Home Alone', 'Mean Girls', 'The Matrix', 'Top Gun', 'Inception', 'Rocky', 'Grease', 'The Godfather', 'Ghostbusters',
      'Back to the Future', 'Pirates of the Caribbean', 'The Wizard of Oz', 'The Hunger Games', 'Despicable Me', 'Cars', 'Fast and Furious', 'James Bond', 'Twilight', 'Ratatouille',
      'Mamma Mia', 'Friends', 'The Office', 'SpongeBob', 'The Simpsons', 'Squid Game', 'Stranger Things', 'Game of Thrones', 'Breaking Bad', 'Pokemon',
      'Survivor', 'Love Island', 'Shark Tank', 'The Bachelor',
    ],
    pairs: [
      ['Titanic', 'The Notebook'], ['Frozen', 'Moana'], ['Star Wars', 'Star Trek'], ['Harry Potter', 'Lord of the Rings'], ['The Lion King', 'The Jungle Book'],
      ['Jurassic Park', 'King Kong'], ['Shrek', 'Kung Fu Panda'], ['Finding Nemo', 'The Little Mermaid'], ['Home Alone', 'Elf'], ['Mean Girls', 'Clueless'],
      ['The Matrix', 'Inception'], ['Top Gun', 'Fast and Furious'], ['Rocky', 'Karate Kid'], ['Grease', 'High School Musical'], ['The Office', 'Parks and Rec'],
      ['The Simpsons', 'Family Guy'], ['Squid Game', 'The Hunger Games'], ['Survivor', 'Love Island'], ['Breaking Bad', 'Ozark'], ['Ghostbusters', 'Men in Black'],
    ],
  },
  characters: {
    label: 'Characters',
    words: [
      'Batman', 'Spider-Man', 'Barbie', 'Mario', 'Pikachu', 'Sherlock Holmes', 'Santa Claus', 'Dracula', 'Cinderella', 'Darth Vader',
      'Hermione', 'Homer Simpson', 'Elsa', 'Gandalf', 'Yoda', 'Wonder Woman', 'Superman', 'Tooth Fairy', 'Easter Bunny', 'Mickey Mouse',
      'Winnie the Pooh', 'Peter Pan', 'Captain Hook', 'The Grinch', 'Willy Wonka', 'Sonic', 'Kermit', 'Garfield', 'Scooby-Doo', 'Tarzan',
      'Robin Hood', 'Frankenstein', 'The Joker', 'Jack Sparrow', 'Thor', 'Hulk', 'Indiana Jones', 'Rapunzel', 'Pinocchio', 'Godzilla',
      'Cupid', 'Zeus', 'Mary Poppins',
    ],
    pairs: [
      ['Batman', 'Iron Man'], ['Mario', 'Sonic'], ['Gandalf', 'Dumbledore'], ['Santa Claus', 'Easter Bunny'], ['Dracula', 'Frankenstein'],
      ['Cinderella', 'Rapunzel'], ['Darth Vader', 'Voldemort'], ['Elsa', 'Jack Frost'], ['Homer Simpson', 'Peter Griffin'], ['Mickey Mouse', 'Bugs Bunny'],
      ['Winnie the Pooh', 'Paddington'], ['Captain Hook', 'Jack Sparrow'], ['The Grinch', 'Scrooge'], ['Tarzan', 'Mowgli'], ['Robin Hood', 'Zorro'],
      ['King Kong', 'Godzilla'], ['Thor', 'Zeus'], ['The Joker', 'Pennywise'], ['Barbie', 'Ken'], ['Hulk', 'Shrek'],
      ['Sherlock Holmes', 'Scooby-Doo'],
    ],
  },
  college: {
    label: 'College',
    words: [
      'Dorm Room', 'Dining Hall', 'Midterm', 'Office Hours', 'Frat Party', 'Roommate', 'Group Project', 'Spring Break', 'Lecture', 'All-Nighter',
      'Professor', 'Graduation', 'Textbook', 'Campus Tour', 'Study Abroad', 'Internship', 'Career Fair', 'Finals Week', 'Meal Plan', 'Tailgate',
      'Syllabus', 'Hackathon', 'Orientation', 'Formal', 'Rush Week', 'Student ID', 'Sorority', 'Student Loans', 'Pop Quiz', 'Extra Credit',
      'Homecoming', 'Thesis', 'Group Chat', 'Fire Drill', 'Laundry Day', 'Parking Ticket', 'Plagiarism', 'Gap Year', 'Freshman', 'Free Pizza',
      'Cramming',
    ],
    pairs: [
      ['Midterm', 'Pop Quiz'], ['Office Hours', 'Tutoring'], ['Frat Party', 'Formal'], ['Roommate', 'RA'], ['Spring Break', 'Study Abroad'],
      ['Professor', 'TA'], ['Graduation', 'Orientation'], ['Internship', 'Part-Time Job'], ['Career Fair', 'Job Interview'], ['Dining Hall', 'Food Court'],
      ['Tailgate', 'Homecoming'], ['Dorm Room', 'Apartment'], ['Hackathon', 'All-Nighter'], ['Sorority', 'Fraternity'], ['Extra Credit', 'Curve'],
      ['Student Loans', 'Tuition'], ['Group Project', 'Lab Partner'], ['Syllabus', 'Textbook'],
    ],
  },
  party: {
    label: 'Party',
    words: [
      'Karaoke', 'Beer Pong', 'Dance Floor', 'Playlist', 'Confetti', 'Costume Party', 'Hangover', 'Red Cup', 'Photo Booth', 'Disco Ball',
      'Balloons', 'Surprise Party', 'Afterparty', 'Glow Sticks', 'Pool Party', 'Bonfire', 'House Party', 'Limbo', 'Truth or Dare', 'Pinata',
      'Keg', 'Fog Machine', 'Wine Night', 'Game Night', 'Sleepover', 'Party Hat', 'Flip Cup', 'Bouncer', 'Guest List', 'Hot Tub',
      'Slow Dance', 'Rooftop', 'Toga Party', 'Chips and Dip', 'Noise Complaint', 'Last Call', 'Drunk Text', 'Uber Home', 'Plus One', 'Bachelorette',
      "New Year's Eve", 'Halloween', 'Sparklers',
    ],
    pairs: [
      ['Karaoke', 'Open Mic'], ['Beer Pong', 'Flip Cup'], ['Afterparty', 'Pregame'], ['Pool Party', 'Hot Tub'], ['Bonfire', 'Barbecue'],
      ['Truth or Dare', 'Never Have I Ever'], ['Game Night', 'Trivia Night'], ['Prom', 'Wedding Reception'], ['Disco Ball', 'Strobe Light'], ['Glow Sticks', 'Sparklers'],
      ['Limbo', 'Twister'], ["New Year's Eve", 'Fourth of July'], ['Pinata', 'Birthday Cake'], ['Dance Floor', 'Mosh Pit'], ['Costume Party', 'Halloween'],
      ['Bouncer', 'Bartender'], ['Hangover', 'Food Coma'],
    ],
  },
  travel: {
    label: 'Travel',
    words: [
      'Passport', 'Suitcase', 'Jet Lag', 'Hostel', 'Road Trip', 'Souvenir', 'Boarding Pass', 'Tour Guide', 'Window Seat', 'Layover',
      'Backpacking', 'Postcard', 'Paris', 'Tokyo', 'New York', 'London', 'Hawaii', 'Las Vegas', 'Rome', 'Iceland',
      'Mexico City', 'Sydney', 'Safari', 'Snorkeling', 'Gondola', 'Hot Air Balloon', 'Airbnb', 'Duty Free', 'Sunscreen', 'Hiking Trail',
      'Waterfall', 'Volcano', 'Northern Lights', 'Eiffel Tower', 'Great Wall', 'Seoul', 'Lost Luggage', 'Customs', 'Venice', 'Egypt',
      'Disney World', 'Grand Canyon',
    ],
    pairs: [
      ['Paris', 'Rome'], ['Tokyo', 'Seoul'], ['New York', 'London'], ['Hawaii', 'Bali'], ['Iceland', 'Alaska'],
      ['Hostel', 'Airbnb'], ['Camping', 'Glamping'], ['Passport', 'Boarding Pass'], ['Snorkeling', 'Scuba Diving'], ['Hot Air Balloon', 'Paragliding'],
      ['Eiffel Tower', 'Statue of Liberty'], ['Great Wall', 'Pyramids'], ['Waterfall', 'Hot Spring'], ['Window Seat', 'Aisle Seat'], ['Layover', 'Flight Delay'],
      ['Disney World', 'Universal Studios'], ['Road Trip', 'Train Ride'], ['Souvenir', 'Postcard'],
    ],
  },
} as const satisfies Record<string, { label: string; words: readonly string[]; pairs: readonly (readonly [string, string])[] }>;

export type CategoryId = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];
