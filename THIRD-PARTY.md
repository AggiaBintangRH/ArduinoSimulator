# Third-party code and assets

## avr8js

The AVR CPU core is [avr8js](https://github.com/wokwi/avr8js), used as an npm
dependency. MIT licensed, Copyright (c) 2019-2021 Uri Shaked.

## Board artwork

All board artwork in `src/render/boards/` is drawn by this project.

The Arduino Mega 2560 board was previously adapted from
[Wokwi Elements](https://github.com/wokwi/wokwi-elements) (MIT, Copyright (c)
2020 Uri Shaked). That drawing has been replaced. A faithful copy of the real
board leaves nowhere to print the 36 numbers of the 2x18 end header: the header
sits against a notched right edge with 27.8px of bare PCB beside it, and two
columns of numbers only fit there at half the size of the rest of the
silkscreen. The board is now drawn from a layout table, a little longer than
the real one, with a labelled strip either side of that header.

## Pin names

Pin *names* follow Wokwi's, deliberately. That is interoperability rather than
adaptation: a `diagram.json` written on Wokwi refers to pins by exact strings
such as `GND.4` or `5V.2`, and matching them is what lets a project move
between the two.
