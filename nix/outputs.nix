{ inputs, system }:

let
  inherit (pkgs) lib;

  pkgs = import ./pkgs.nix { inherit inputs system; };

  devShells = {
    default = import ./shell.nix { inherit pkgs lib; };
  };

in

{
  inherit devShells;
}
